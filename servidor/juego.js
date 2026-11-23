'use strict';
/**
 * Lógica pura de "Lobos del Pueblo" (juego de roles ocultos tipo Mafia/Werewolf).
 * Sin red ni base de datos: recibe un estado y una acción, devuelve un estado nuevo.
 * El servidor (Socket.IO) solo reenvía lo que devuelve `vista()`, que es lo único
 * que cada jugador puede ver. NUNCA enviar el `estado` completo a un cliente.
 *
 * Fases: lobos → vidente → bruja → (amanecer automático) → [cazador] → votacion → [cazador] → lobos …
 * Simplificaciones respecto al juego de mesa: sin capitán, empate en la votación = nadie muere,
 * la bruja decide curar y/o envenenar en una sola acción.
 */

const ROL = { ALDEANO: 'aldeano', LOBO: 'lobo', VIDENTE: 'vidente', BRUJA: 'bruja', CAZADOR: 'cazador' };
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
  for (const unico of [ROL.VIDENTE, ROL.BRUJA, ROL.CAZADOR]) {
    if (roles.filter((r) => r === unico).length > 1) falla(`Solo puede haber un ${unico}`);
  }
}

// ---------- creación ----------
/** jugadores: [{ id, nombre }]. opciones.roles: lista de roles (uno por jugador) o se reparte por defecto. */
function crearPartida(jugadores, { roles, rng = Math.random } = {}) {
  const ids = new Set(jugadores.map((j) => j.id));
  if (ids.size !== jugadores.length) falla('Hay jugadores repetidos');
  const lista = roles ?? rolesPorDefecto(jugadores.length);
  validarRoles(lista, jugadores.length);
  const barajados = mezclar(lista, rng);
  const estado = {
    fase: null,
    ronda: 1,
    jugadores: jugadores.map((j, i) => ({ id: j.id, nombre: j.nombre, rol: barajados[i], vivo: true })),
    noche: nocheVacia(),
    bruja: { pocionVida: true, pocionMuerte: true },
    vistos: [], // lo que ha averiguado la vidente: [{ id, rol }]
    votos: {},
    pendienteCazador: null, // { cazadorId, volverA: 'votacion' | 'noche' }
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
const ORDEN_NOCHE = ['lobos', 'vidente', 'bruja'];

/** ¿Hay alguien vivo que pueda actuar en esa fase de noche? */
function hayActor(e, fase) {
  if (fase === 'lobos') return vivosConRol(e, ROL.LOBO).length > 0;
  if (fase === 'vidente') return vivosConRol(e, ROL.VIDENTE).length > 0;
  if (fase === 'bruja') {
    return vivosConRol(e, ROL.BRUJA).length > 0 && (e.bruja.pocionVida || e.bruja.pocionMuerte);
  }
  return false;
}

function primeraFaseNoche(e) {
  return ORDEN_NOCHE.find((f) => hayActor(e, f)) ?? 'amanecer';
}

function faseNocheSiguiente(e, actual) {
  const resto = ORDEN_NOCHE.slice(ORDEN_NOCHE.indexOf(actual) + 1);
  return resto.find((f) => hayActor(e, f)) ?? 'amanecer';
}

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

function matar(e, id, causa) {
  const j = porId(e, id);
  j.vivo = false;
  e.publico.push({ tipo: 'muerte', jugador: j.id, nombre: j.nombre, rol: j.rol, causa, ronda: e.ronda });
  return j;
}

function empezarNoche(e) {
  e.ronda += 1;
  e.noche = nocheVacia();
  e.votos = {};
  e.fase = primeraFaseNoche(e);
  if (e.fase === 'amanecer') amanecer(e);
}

/** Pasa a donde corresponda después de morir alguien (puede interrumpir el cazador). */
function continuar(e, muertos, volverA) {
  const cazador = muertos.find((j) => j.rol === ROL.CAZADOR);
  if (terminarSiHayGanador(e)) return;
  if (cazador) {
    e.pendienteCazador = { cazadorId: cazador.id, volverA };
    e.fase = 'cazador';
    return;
  }
  if (volverA === 'votacion') e.fase = 'votacion';
  else empezarNoche(e);
}

function amanecer(e) {
  const muertos = [];
  const { victima, curada, veneno } = e.noche;
  if (victima && !curada) muertos.push(matar(e, victima, 'lobos'));
  if (veneno && porId(e, veneno).vivo) muertos.push(matar(e, veneno, 'veneno'));
  if (muertos.length === 0) e.publico.push({ tipo: 'sin_muertes', ronda: e.ronda });
  e.votos = {};
  continuar(e, muertos, 'votacion');
}

// ---------- acciones ----------
function elegirMasVotado(votos, rng) {
  const cuenta = {};
  for (const objetivo of Object.values(votos)) if (objetivo) cuenta[objetivo] = (cuenta[objetivo] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(cuenta));
  const empatados = Object.keys(cuenta).filter((id) => cuenta[id] === max);
  return { cuenta, empatados, elegido: empatados.length === 1 ? empatados[0] : null };
}

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

const ACCIONES = {
  lobos(e, yo, accion, rng) {
    if (accion.tipo !== 'matar') falla('Acción no válida en esta fase');
    if (yo.rol !== ROL.LOBO) falla('Solo los lobos actúan ahora');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    if (objetivo.rol === ROL.LOBO) falla('Un lobo no puede atacar a otro lobo');
    e.noche.votosLobos[yo.id] = objetivo.id;
    const lobos = vivosConRol(e, ROL.LOBO);
    if (!lobos.every((l) => e.noche.votosLobos[l.id])) return;
    const { empatados, elegido } = elegirMasVotado(e.noche.votosLobos);
    e.noche.victima = elegido ?? empatados[Math.floor(rng() * empatados.length)];
    avanzarNoche(e, 'lobos');
  },

  vidente(e, yo, accion) {
    if (accion.tipo !== 'ver') falla('Acción no válida en esta fase');
    if (yo.rol !== ROL.VIDENTE) falla('Solo la vidente actúa ahora');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    if (objetivo.id === yo.id) falla('No puedes verte a ti misma');
    e.vistos.push({ id: objetivo.id, rol: objetivo.rol });
    avanzarNoche(e, 'vidente');
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
    const pendiente = e.pendienteCazador;
    if (!pendiente || yo.id !== pendiente.cazadorId) falla('Solo el cazador puede disparar ahora');
    const objetivo = exigirObjetivoVivo(e, accion.objetivo);
    const volverA = pendiente.volverA;
    e.pendienteCazador = null;
    const muerto = matar(e, objetivo.id, 'cazador');
    continuar(e, [muerto], volverA);
  },

  votacion(e, yo, accion) {
    if (accion.tipo !== 'votar') falla('Acción no válida en esta fase');
    if (accion.objetivo) exigirObjetivoVivo(e, accion.objetivo);
    e.votos[yo.id] = accion.objetivo ?? null; // null = abstención
    if (!vivos(e).every((j) => j.id in e.votos)) return;
    const { cuenta, elegido } = elegirMasVotado(e.votos);
    e.publico.push({ tipo: 'recuento', ronda: e.ronda, votos: cuenta });
    if (!elegido) {
      e.publico.push({ tipo: 'sin_linchamiento', ronda: e.ronda });
      return empezarNoche(e);
    }
    const muerto = matar(e, elegido, 'votacion');
    continuar(e, [muerto], 'noche');
  },
};

function avanzarNoche(e, desde) {
  e.fase = faseNocheSiguiente(e, desde);
  if (e.fase === 'amanecer') amanecer(e);
}

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
  // El cazador ya está muerto cuando dispara: es el único muerto que puede actuar (su último disparo).
  const yo = estado.fase === 'cazador' ? porId(e, jugadorId) : exigirVivo(e, jugadorId);
  if (!yo) falla('Jugador desconocido');
  handler(e, yo, accion, rng);
  return e;
}

// ---------- lo que ve cada jugador ----------
/** Quién debe actuar ahora (ids). Útil para temporizadores y para marcar "esperando a…". */
function pendientes(e) {
  switch (e.fase) {
    case 'lobos': return vivosConRol(e, ROL.LOBO).filter((l) => !e.noche.votosLobos[l.id]).map((j) => j.id);
    case 'vidente': return vivosConRol(e, ROL.VIDENTE).map((j) => j.id);
    case 'bruja': return vivosConRol(e, ROL.BRUJA).map((j) => j.id);
    case 'cazador': return e.pendienteCazador ? [e.pendienteCazador.cazadorId] : [];
    case 'votacion': return vivos(e).filter((j) => !(j.id in e.votos)).map((j) => j.id);
    default: return [];
  }
}

/** Vista segura para UN jugador: no incluye roles de otros vivos ni acciones secretas ajenas. */
function vista(e, jugadorId) {
  const yo = porId(e, jugadorId);
  if (!yo) falla('Jugador desconocido');
  const revelar = (j) => j.id === yo.id || !j.vivo || e.fase === 'fin';
  const v = {
    fase: e.fase,
    ronda: e.ronda,
    ganador: e.ganador,
    yo: { id: yo.id, nombre: yo.nombre, rol: yo.rol, vivo: yo.vivo },
    jugadores: e.jugadores.map((j) => ({ id: j.id, nombre: j.nombre, vivo: j.vivo, ...(revelar(j) ? { rol: j.rol } : {}) })),
    publico: e.publico,
    puedeActuar: pendientes(e).includes(yo.id),
  };
  if (e.fase === 'votacion') v.yaVotaron = Object.keys(e.votos);
  if (yo.rol === ROL.LOBO) {
    v.companerosLobo = e.jugadores.filter((j) => j.rol === ROL.LOBO && j.id !== yo.id).map((j) => j.id);
    if (e.fase === 'lobos') v.votosLobos = { ...e.noche.votosLobos };
  }
  if (yo.rol === ROL.VIDENTE) v.vistos = [...e.vistos];
  if (yo.rol === ROL.BRUJA) {
    v.pociones = { ...e.bruja };
    if (e.fase === 'bruja') v.victimaDeLosLobos = e.noche.victima;
  }
  return v;
}

module.exports = { ROL, MIN_JUGADORES, MAX_JUGADORES, crearPartida, actuar, vista, pendientes, rolesPorDefecto };
