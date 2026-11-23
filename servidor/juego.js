'use strict';
/**
 * Lógica pura de "El Lobo y el Pueblo" (juego de roles ocultos tipo Mafia/Werewolf).
 * Sin red ni base de datos: recibe un estado y una acción, devuelve un estado nuevo.
 * El servidor (Socket.IO) solo reenvía lo que devuelve `vista()`, que es lo único
 * que cada jugador puede ver. NUNCA enviar el `estado` completo a un cliente.
 *
 * Noche (en este orden): cupido (solo la 1.ª noche) → vidente → lobos → bruja → amanecer automático.
 * Día: [elección de capitán, solo el 1.er día] → votación. Las "últimas acciones" (disparo del cazador,
 * sucesión del capitán) se atienden en cola, antes de seguir.
 *
 * Simplificaciones respecto al juego de mesa: empate en la votación = nadie muere (salvo que el voto
 * del capitán desempate), la bruja decide curar y/o envenenar en una sola acción, y los enamorados
 * solo mueren juntos (no ganan como pareja).
 */

const ROL = { ALDEANO: 'aldeano', LOBO: 'lobo', VIDENTE: 'vidente', BRUJA: 'bruja', CAZADOR: 'cazador', CUPIDO: 'cupido' };
const UNICOS = [ROL.VIDENTE, ROL.BRUJA, ROL.CAZADOR, ROL.CUPIDO];
const FASES_NOCHE = ['cupido', 'vidente', 'lobos', 'bruja'];
const MIN_JUGADORES = 5;
const MAX_JUGADORES = 12;

// ---------- utilidades ----------
const clonar = (x) => structuredClone(x);
const falla = (msg) => { throw new Error(msg); };

function mezclar(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const porId = (e, id) => e.jugadores.find((j) => j.id === id);
const vivos = (e) => e.jugadores.filter((j) => j.vivo);
const vivosConRol = (e, rol) => vivos(e).filter((j) => j.rol === rol);

/** Reparto por defecto según el número de jugadores. */
function rolesPorDefecto(n) {
  if (n < MIN_JUGADORES || n > MAX_JUGADORES) falla(`La partida es de ${MIN_JUGADORES} a ${MAX_JUGADORES} jugadores`);
  const lobos = Math.max(1, Math.floor(n / 4));
  const especiales = [ROL.VIDENTE];
  if (n >= 6) especiales.push(ROL.BRUJA);
  if (n >= 8) especiales.push(ROL.CAZADOR);
  const roles = [...Array(lobos).fill(ROL.LOBO), ...especiales];
  while (roles.length < n) roles.push(ROL.ALDEANO);
  return roles;
}

function validarRoles(roles, n) {
  if (!Array.isArray(roles) || roles.length !== n) falla('La lista de roles debe tener un rol por jugador');
  if (roles.some((r) => !Object.values(ROL).includes(r))) falla('Rol desconocido');
  if (!roles.includes(ROL.LOBO)) falla('Debe haber al menos un lobo');
  if (roles.every((r) => r === ROL.LOBO)) falla('Debe haber al menos un jugador que no sea lobo');
  for (const unico of UNICOS) {
    if (roles.filter((r) => r === unico).length > 1) falla(`Solo puede haber un ${unico}`);
  }
}

// ---------- creación ----------
/**
 * jugadores: [{ id, nombre }]. opciones.roles: un rol por jugador (si no, reparto por defecto).
 * opciones.capitan: el pueblo elige un capitán el primer día. opciones.revelarRoles: al morir se muestra el rol.
 */
function crearPartida(jugadores, { roles, rng = Math.random, capitan = false, revelarRoles = false } = {}) {
  const ids = new Set(jugadores.map((j) => j.id));
  if (ids.size !== jugadores.length) falla('Hay jugadores repetidos');
  const lista = roles ?? rolesPorDefecto(jugadores.length);
  validarRoles(lista, jugadores.length);
  const barajados = mezclar(lista, rng);
  const estado = {
    fase: null,
    ronda: 1,
    jugadores: jugadores.map((j, i) => ({ id: j.id, nombre: j.nombre, rol: barajados[i], vivo: true })),
    usaCapitan: !!capitan,
    revelarRoles: !!revelarRoles,
    capitan: null,
    enamorados: [], // [idA, idB] cuando Cupido ya actuó
    noche: nocheVacia(),
    bruja: { pocionVida: true, pocionMuerte: true },
    vistos: [], // lo que ha averiguado la vidente: [{ id, rol }]
    votos: {},
    cola: [], // últimas acciones pendientes: { tipo: 'cazador' | 'sucesor', jugador }
    volverA: null, // 'dia' | 'noche': a dónde ir cuando la cola se vacíe
    publico: [],
    ganador: null,
  };
  estado.fase = primeraFaseNoche(estado);
  return estado;
}

function nocheVacia() {
  return { votosLobos: {}, victima: null, curada: false, veneno: null };
}

// ---------- flujo de fases ----------
/** ¿Hay alguien vivo que pueda actuar en esa fase de noche? */
function hayActor(e, fase) {
  if (fase === 'cupido') return e.ronda === 1 && e.enamorados.length === 0 && vivosConRol(e, ROL.CUPIDO).length > 0;
  if (fase === 'lobos') return vivosConRol(e, ROL.LOBO).length > 0;
  if (fase === 'vidente') return vivosConRol(e, ROL.VIDENTE).length > 0;
  if (fase === 'bruja') return vivosConRol(e, ROL.BRUJA).length > 0 && (e.bruja.pocionVida || e.bruja.pocionMuerte);
  return false;
}

const primeraFaseNoche = (e) => FASES_NOCHE.find((f) => hayActor(e, f)) ?? 'amanecer';
const faseNocheSiguiente = (e, actual) => FASES_NOCHE.slice(FASES_NOCHE.indexOf(actual) + 1).find((f) => hayActor(e, f)) ?? 'amanecer';

function comprobarGanador(e) {
  const lobos = vivosConRol(e, ROL.LOBO).length;
  const resto = vivos(e).length - lobos;
  if (lobos === 0) return 'pueblo';
  if (lobos >= resto) return 'lobos';
  return null;
}

function terminarSiHayGanador(e) {
  const g = comprobarGanador(e);
  if (!g) return false;
  e.ganador = g;
  e.fase = 'fin';
  e.publico.push({ tipo: 'fin', ganador: g });
  return true;
}

/** Mata a un jugador (y a su pareja si estaba enamorado). Devuelve todos los que murieron. */
function matar(e, id, causa) {
  const muertos = [];
  const baja = (jid, c) => {
    const j = porId(e, jid);
    if (!j.vivo) return;
    j.vivo = false;
    e.publico.push({ tipo: 'muerte', jugador: j.id, nombre: j.nombre, rol: j.rol, causa: c, ronda: e.ronda });
    muertos.push(j);
    if (e.enamorados.includes(jid)) baja(e.enamorados.find((x) => x !== jid), 'amor');
  };
  baja(id, causa);
  return muertos;
}

function empezarNoche(e) {
  e.ronda += 1;
  e.noche = nocheVacia();
  e.votos = {};
  e.fase = primeraFaseNoche(e);
  if (e.fase === 'amanecer') amanecer(e);
}

function iniciarDia(e) {
  e.votos = {};
  e.fase = e.usaCapitan && !e.capitan && e.ronda === 1 ? 'capitan' : 'votacion';
}

const siguiente = (e, volverA) => (volverA === 'dia' ? iniciarDia(e) : empezarNoche(e));

/** Anota las últimas acciones que dejan los muertos: el cazador dispara y el capitán nombra sucesor. */
function encolar(e, muertos) {
  for (const m of muertos) {
    if (m.rol === ROL.CAZADOR) e.cola.push({ tipo: 'cazador', jugador: m.id });
    if (e.capitan === m.id) e.cola.push({ tipo: 'sucesor', jugador: m.id });
  }
}

/** Después de que muera alguien: ¿terminó la partida? ¿hay últimas acciones? Si no, sigue el flujo. */
function continuar(e, muertos, volverA) {
  if (terminarSiHayGanador(e)) return;
  encolar(e, muertos);
  if (e.cola.length) { e.volverA = volverA; e.fase = e.cola[0].tipo; return; }
  siguiente(e, volverA);
}

function terminarUltimaAccion(e, nuevosMuertos) {
  e.cola.shift();
  if (terminarSiHayGanador(e)) return;
  encolar(e, nuevosMuertos);
  if (e.cola.length) { e.fase = e.cola[0].tipo; return; }
  const volverA = e.volverA;
  e.volverA = null;
  siguiente(e, volverA);
}

function amanecer(e) {
  const { victima, curada, veneno } = e.noche;
  const muertos = [];
  if (victima && !curada) muertos.push(...matar(e, victima, 'lobos'));
  if (veneno) muertos.push(...matar(e, veneno, 'veneno'));
  if (muertos.length === 0) e.publico.push({ tipo: 'sin_muertes', ronda: e.ronda });
  continuar(e, muertos, 'dia');
}

// ---------- acciones ----------
/** Recuento de votos. `pesoDe(votante)` permite que el voto del capitán valga doble. */
function contar(votos, pesoDe = () => 1) {
  const cuenta = {};
  for (const [votante, objetivo] of Object.entries(votos)) if (objetivo) cuenta[objetivo] = (cuenta[objetivo] ?? 0) + pesoDe(votante);
  const max = Math.max(0, ...Object.values(cuenta));
  return { cuenta, empatados: Object.keys(cuenta).filter((id) => cuenta[id] === max) };
}

const alAzar = (lista, rng) => lista[Math.floor(rng() * lista.length)];

function exigirVivo(e, id) {
  const j = porId(e, id);
  if (!j) falla('Jugador desconocido');
  if (!j.vivo) falla('Un jugador muerto no puede actuar');
  return j;
}

function exigirObjetivoVivo(e, id) {
  const j = porId(e, id);
  if (!j || !j.vivo) falla('El objetivo no es válido');
  return j;
}

function avanzarNoche(e, desde) {
  e.fase = faseNocheSiguiente(e, desde);
  if (e.fase === 'amanecer') amanecer(e);
}

const ACCIONES = {
  cupido(e, yo, accion) {
    if (accion.tipo !== 'enamorar') falla('Acción no válida en esta fase');
    if (yo.rol !== ROL.CUPIDO) falla('Solo Cupido actúa ahora');
    const [a, b] = Array.isArray(accion.objetivos) ? accion.objetivos : [];
    if (!a || !b || a === b) falla('Elige a dos jugadores distintos');
    exigirObjetivoVivo(e, a); exigirObjetivoVivo(e, b);
    e.enamorados = [a, b];
    avanzarNoche(e, 'cupido');
  },

  vidente(e, yo, accion) {
    if (accion.tipo !== 'ver') falla('Acción no válida en esta fase');
    if (yo.rol !== ROL.VIDENTE) falla('Solo la vidente actúa ahora');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    if (objetivo.id === yo.id) falla('No puedes verte a ti misma');
    e.vistos.push({ id: objetivo.id, rol: objetivo.rol });
    avanzarNoche(e, 'vidente');
  },

  lobos(e, yo, accion, rng) {
    if (accion.tipo !== 'matar') falla('Acción no válida en esta fase');
    if (yo.rol !== ROL.LOBO) falla('Solo los lobos actúan ahora');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    if (objetivo.rol === ROL.LOBO) falla('Un lobo no puede atacar a otro lobo');
    e.noche.votosLobos[yo.id] = objetivo.id;
    if (!vivosConRol(e, ROL.LOBO).every((l) => e.noche.votosLobos[l.id])) return;
    const { empatados } = contar(e.noche.votosLobos);
    e.noche.victima = empatados.length === 1 ? empatados[0] : alAzar(empatados, rng);
    avanzarNoche(e, 'lobos');
  },

  bruja(e, yo, accion) {
    if (accion.tipo !== 'pocion') falla('Acción no válida en esta fase');
    if (yo.rol !== ROL.BRUJA) falla('Solo la bruja actúa ahora');
    if (accion.curar) {
      if (!e.bruja.pocionVida) falla('Ya usaste la poción de vida');
      if (!e.noche.victima) falla('No hay nadie a quien curar');
      e.bruja.pocionVida = false;
      e.noche.curada = true;
    }
    if (accion.envenenar) {
      if (!e.bruja.pocionMuerte) falla('Ya usaste la poción de muerte');
      const objetivo = exigirObjetivoVivo(e, accion.envenenar);
      if (objetivo.id === yo.id) falla('No puedes envenenarte a ti misma');
      e.bruja.pocionMuerte = false;
      e.noche.veneno = objetivo.id;
    }
    avanzarNoche(e, 'bruja');
  },

  cazador(e, yo, accion) {
    if (accion.tipo !== 'disparar') falla('Acción no válida en esta fase');
    if (e.cola[0]?.jugador !== yo.id) falla('Solo el cazador puede disparar ahora');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    terminarUltimaAccion(e, matar(e, objetivo.id, 'cazador'));
  },

  sucesor(e, yo, accion) {
    if (accion.tipo !== 'sucesor') falla('Acción no válida en esta fase');
    if (e.cola[0]?.jugador !== yo.id) falla('Solo el capitán puede nombrar sucesor');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    e.capitan = objetivo.id;
    e.publico.push({ tipo: 'capitan', jugador: objetivo.id, nombre: objetivo.nombre, sucesion: true });
    terminarUltimaAccion(e, []);
  },

  capitan(e, yo, accion, rng) {
    if (accion.tipo !== 'elegir') falla('Acción no válida en esta fase');
    if (accion.objetivo) exigirObjetivoVivo(e, accion.objetivo);
    e.votos[yo.id] = accion.objetivo ?? null;
    if (!vivos(e).every((j) => j.id in e.votos)) return;
    const { empatados } = contar(e.votos);
    const elegido = empatados.length === 0 ? null : empatados.length === 1 ? empatados[0] : alAzar(empatados, rng);
    if (elegido) {
      e.capitan = elegido;
      e.publico.push({ tipo: 'capitan', jugador: elegido, nombre: porId(e, elegido).nombre });
    } else {
      e.publico.push({ tipo: 'sin_capitan' });
    }
    e.votos = {};
    e.fase = 'votacion';
  },

  votacion(e, yo, accion) {
    if (accion.tipo !== 'votar') falla('Acción no válida en esta fase');
    if (accion.objetivo) exigirObjetivoVivo(e, accion.objetivo);
    e.votos[yo.id] = accion.objetivo ?? null; // null = abstención
    if (!vivos(e).every((j) => j.id in e.votos)) return;
    const { cuenta, empatados } = contar(e.votos, (v) => (v === e.capitan ? 2 : 1));
    e.publico.push({ tipo: 'recuento', ronda: e.ronda, votos: cuenta });
    // El voto del capitán vale doble y, si aun así hay empate, decide entre los empatados.
    const votoDelCapitan = e.votos[e.capitan];
    const elegido = empatados.length === 1 ? empatados[0] : empatados.includes(votoDelCapitan) ? votoDelCapitan : null;
    if (!elegido) {
      e.publico.push({ tipo: 'sin_linchamiento', ronda: e.ronda });
      return empezarNoche(e);
    }
    continuar(e, matar(e, elegido, 'votacion'), 'noche');
  },
};

/**
 * Aplica una acción de un jugador y devuelve un estado nuevo (el original no se modifica).
 * Lanza Error con un mensaje en español si la acción no es válida.
 */
function actuar(estado, jugadorId, accion, rng = Math.random) {
  if (estado.fase === 'fin') falla('La partida ya terminó');
  if (!accion || typeof accion !== 'object') falla('Acción no válida');
  const handler = ACCIONES[estado.fase];
  if (!handler) falla('No se puede actuar en esta fase');
  const e = clonar(estado);
  // El cazador y el capitán ya están muertos cuando actúan por última vez: son los únicos muertos que pueden hacerlo.
  const ultima = estado.fase === 'cazador' || estado.fase === 'sucesor';
  const yo = ultima ? porId(e, jugadorId) : exigirVivo(e, jugadorId);
  if (!yo) falla('Jugador desconocido');
  handler(e, yo, accion, rng);
  return e;
}

// ---------- lo que ve cada jugador ----------
/** Quién debe actuar ahora (ids). Útil para temporizadores y para marcar "esperando a…". */
function pendientes(e) {
  switch (e.fase) {
    case 'cupido': return vivosConRol(e, ROL.CUPIDO).map((j) => j.id);
    case 'vidente': return vivosConRol(e, ROL.VIDENTE).map((j) => j.id);
    case 'lobos': return vivosConRol(e, ROL.LOBO).filter((l) => !e.noche.votosLobos[l.id]).map((j) => j.id);
    case 'bruja': return vivosConRol(e, ROL.BRUJA).map((j) => j.id);
    case 'cazador':
    case 'sucesor': return e.cola.length ? [e.cola[0].jugador] : [];
    case 'capitan':
    case 'votacion': return vivos(e).filter((j) => !(j.id in e.votos)).map((j) => j.id);
    default: return [];
  }
}

/** El registro público no delata roles ni cómo murió alguien de noche (lobos o veneno se ven igual). */
function sanear(ev, e) {
  if (ev.tipo !== 'muerte') return ev;
  const out = { ...ev };
  if (out.causa === 'lobos' || out.causa === 'veneno') out.causa = 'noche';
  if (!e.revelarRoles) delete out.rol;
  return out;
}

/** Vista segura para UN jugador: no incluye roles de otros vivos ni acciones secretas ajenas. */
function vista(e, jugadorId) {
  const yo = porId(e, jugadorId);
  if (!yo) falla('Jugador desconocido');
  const puedeActuar = pendientes(e).includes(yo.id);
  // Las subfases de la noche solo las ve quien actúa: si no, mostrar "vidente" o "bruja" delataría qué roles siguen vivos.
  const enNoche = FASES_NOCHE.includes(e.fase);
  const revelar = (j) => j.id === yo.id || e.fase === 'fin' || (!j.vivo && e.revelarRoles);
  const v = {
    fase: enNoche && !puedeActuar ? 'noche' : e.fase,
    ronda: e.ronda,
    ganador: e.ganador,
    capitan: e.capitan,
    yo: { id: yo.id, nombre: yo.nombre, rol: yo.rol, vivo: yo.vivo },
    jugadores: e.jugadores.map((j) => ({ id: j.id, nombre: j.nombre, vivo: j.vivo, ...(revelar(j) ? { rol: j.rol } : {}) })),
    publico: e.publico.map((ev) => sanear(ev, e)),
    puedeActuar,
  };
  if (e.fase === 'votacion' || e.fase === 'capitan') v.yaVotaron = Object.keys(e.votos);
  if (yo.rol === ROL.LOBO) {
    v.companerosLobo = e.jugadores.filter((j) => j.rol === ROL.LOBO && j.id !== yo.id).map((j) => j.id);
    if (e.fase === 'lobos') v.votosLobos = { ...e.noche.votosLobos };
  }
  if (yo.rol === ROL.VIDENTE) v.vistos = [...e.vistos];
  if (yo.rol === ROL.BRUJA) {
    v.pociones = { ...e.bruja };
    if (e.fase === 'bruja') v.victimaDeLosLobos = e.noche.victima;
  }
  if (e.enamorados.includes(yo.id)) v.enamoradoCon = e.enamorados.find((x) => x !== yo.id);
  if (yo.rol === ROL.CUPIDO && e.enamorados.length) v.enamorados = [...e.enamorados];
  return v;
}

module.exports = {
  ROL, FASES_NOCHE, MIN_JUGADORES, MAX_JUGADORES, crearPartida, actuar, vista, pendientes, rolesPorDefecto,
};
