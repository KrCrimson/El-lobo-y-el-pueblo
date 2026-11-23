'use strict';
/**
 * Gestión de salas: quién está en cada sala, quién es el anfitrión, temporizadores y reconexión.
 * No conoce Socket.IO: recibe `socketId` y devuelve datos. Reloj y temporizadores son inyectables
 * para poder probarlo sin esperar.
 *
 * Privacidad: lo único que sale de aquí hacia un cliente es `vistaDe()`.
 * Nunca se entrega el token de otro jugador ni el estado completo del juego.
 */
const crypto = require('node:crypto');
const { ROL, MIN_JUGADORES, MAX_JUGADORES, crearPartida, actuar, vista, pendientes } = require('./juego');

const TIEMPOS = {
  lobos: 60_000, vidente: 40_000, bruja: 40_000, cazador: 30_000, votacion: 120_000,
  nocheMin: 20_000, // duración mínima visible de la noche (evita delatar qué roles siguen vivos por el tiempo)
  salaInactiva: 30 * 60_000,
};
const NOCHE = ['lobos', 'vidente', 'bruja'];
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sin I ni O para no confundir con 1 y 0
const MAX_SALAS = 100;

const falla = (m) => { throw new Error(m); };

function limpiarNombre(nombre) {
  if (typeof nombre !== 'string') falla('Escribe un nombre');
  const n = nombre.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (n.length < 1 || n.length > 20) falla('El nombre debe tener entre 1 y 20 caracteres');
  return n;
}

function validarToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) falla('Sesión no válida');
  return token;
}

function limpiarCodigo(codigo) {
  const c = typeof codigo === 'string' ? codigo.trim().toUpperCase() : '';
  if (!/^[A-Z]{4}$/.test(c)) falla('Código de sala no válido');
  return c;
}

/** Convierte las opciones del anfitrión en una lista de roles. Sin opciones usa el reparto por defecto. */
function rolesDesdeConfig(n, cfg) {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const lobos = Number.isInteger(cfg.lobos) ? cfg.lobos : 1;
  if (lobos < 1) falla('Debe haber al menos un lobo');
  if (lobos * 2 >= n) falla('Demasiados lobos para esta cantidad de jugadores');
  const roles = Array(lobos).fill(ROL.LOBO);
  if (cfg.vidente) roles.push(ROL.VIDENTE);
  if (cfg.bruja) roles.push(ROL.BRUJA);
  if (cfg.cazador) roles.push(ROL.CAZADOR);
  if (roles.length > n) falla('Hay más roles que jugadores');
  while (roles.length < n) roles.push(ROL.ALDEANO);
  return roles;
}

function crearGestor({
  ahora = Date.now,
  programar = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return () => clearTimeout(t); },
  rng = Math.random,
  tiempos = TIEMPOS,
  alCambiar = () => {},
} = {}) {
  const salas = new Map(); // código → sala
  const porSocket = new Map(); // socketId → { codigo, id }

  const nuevoId = () => crypto.randomBytes(4).toString('hex');
  const cambio = (sala) => { sala.ultimaActividad = ahora(); alCambiar(sala); };

  function codigoNuevo() {
    for (let i = 0; i < 50; i++) {
      const c = Array.from({ length: 4 }, () => LETRAS[Math.floor(rng() * LETRAS.length)]).join('');
      if (!salas.has(c)) return c;
    }
    return falla('No se pudo crear la sala, inténtalo de nuevo');
  }

  function buscarPorSocket(socketId) {
    const ref = porSocket.get(socketId);
    if (!ref) falla('No estás en una sala');
    const sala = salas.get(ref.codigo);
    const jugador = sala?.jugadores.find((j) => j.id === ref.id);
    if (!sala || !jugador) falla('No estás en una sala');
    return { sala, jugador };
  }

  function vincular(sala, jugador, socketId) {
    if (jugador.socketId && jugador.socketId !== socketId) porSocket.delete(jugador.socketId);
    const previa = porSocket.get(socketId);
    if (previa && (previa.codigo !== sala.codigo || previa.id !== jugador.id)) desvincularSocket(socketId);
    jugador.socketId = socketId;
    jugador.conectado = true;
    porSocket.set(socketId, { codigo: sala.codigo, id: jugador.id });
  }

  function desvincularSocket(socketId) {
    const ref = porSocket.get(socketId);
    if (!ref) return;
    porSocket.delete(socketId);
    const sala = salas.get(ref.codigo);
    const j = sala?.jugadores.find((x) => x.id === ref.id);
    if (!sala || !j) return;
    j.socketId = null;
    j.conectado = false;
    if (sala.anfitrionId === j.id) pasarAnfitrion(sala);
    cambio(sala);
  }

  function pasarAnfitrion(sala) {
    const nuevo = sala.jugadores.find((j) => j.conectado);
    if (nuevo) sala.anfitrionId = nuevo.id;
  }

  function destruir(sala) {
    sala.cancelar?.();
    for (const j of sala.jugadores) if (j.socketId) porSocket.delete(j.socketId);
    salas.delete(sala.codigo);
  }

  // ---------- altas y bajas ----------
  function crear({ socketId, nombre, token }) {
    const n = limpiarNombre(nombre); const t = validarToken(token);
    if (salas.size >= MAX_SALAS) falla('Hay demasiadas salas activas, inténtalo más tarde');
    const jugador = { id: nuevoId(), token: t, nombre: n, socketId: null, conectado: false };
    const sala = {
      codigo: codigoNuevo(), jugadores: [jugador], anfitrionId: jugador.id, etapa: 'lobby', juego: null,
      retenido: null, limite: null, cancelar: null, nocheDesde: 0, ultimaActividad: ahora(),
    };
    salas.set(sala.codigo, sala);
    vincular(sala, jugador, socketId);
    cambio(sala);
    return { codigo: sala.codigo };
  }

  function unirse({ socketId, codigo, nombre, token }) {
    const sala = salas.get(limpiarCodigo(codigo)) ?? falla('Esa sala no existe');
    const t = validarToken(token);
    const existente = sala.jugadores.find((j) => j.token === t);
    if (existente) return reconectar({ socketId, codigo: sala.codigo, token: t });
    const n = limpiarNombre(nombre);
    if (sala.etapa !== 'lobby') falla('La partida ya empezó');
    if (sala.jugadores.length >= MAX_JUGADORES) falla('La sala está llena');
    if (sala.jugadores.some((j) => j.nombre.toLowerCase() === n.toLowerCase())) falla('Ya hay alguien con ese nombre en la sala');
    const jugador = { id: nuevoId(), token: t, nombre: n, socketId: null, conectado: false };
    sala.jugadores.push(jugador);
    vincular(sala, jugador, socketId);
    cambio(sala);
    return { codigo: sala.codigo };
  }

  function reconectar({ socketId, codigo, token }) {
    const sala = salas.get(limpiarCodigo(codigo)) ?? falla('Esa sala ya no existe');
    const t = validarToken(token);
    const jugador = sala.jugadores.find((j) => j.token === t) ?? falla('No perteneces a esa sala');
    vincular(sala, jugador, socketId);
    if (!sala.jugadores.some((j) => j.id === sala.anfitrionId && j.conectado)) sala.anfitrionId = jugador.id;
    cambio(sala);
    return { codigo: sala.codigo };
  }

  function salir(socketId) {
    const { sala, jugador } = buscarPorSocket(socketId);
    if (sala.etapa === 'juego') return desvincularSocket(socketId); // en plena partida solo se desconecta
    porSocket.delete(socketId);
    sala.jugadores = sala.jugadores.filter((j) => j.id !== jugador.id);
    if (sala.jugadores.length === 0) return destruir(sala);
    if (sala.anfitrionId === jugador.id) pasarAnfitrion(sala);
    if (!sala.jugadores.some((j) => j.id === sala.anfitrionId)) sala.anfitrionId = sala.jugadores[0].id;
    cambio(sala);
  }

  // ---------- partida ----------
  function empezar(socketId, config) {
    const { sala, jugador } = buscarPorSocket(socketId);
    if (sala.anfitrionId !== jugador.id) falla('Solo el anfitrión puede empezar');
    if (sala.etapa !== 'lobby') falla('La partida ya empezó');
    const presentes = sala.jugadores.filter((j) => j.conectado);
    if (presentes.length < MIN_JUGADORES) falla(`Hacen falta al menos ${MIN_JUGADORES} jugadores conectados`);
    const roles = rolesDesdeConfig(presentes.length, config);
    sala.juego = crearPartida(presentes.map((j) => ({ id: j.id, nombre: j.nombre })), { roles, rng });
    sala.jugadores = presentes;
    sala.etapa = 'juego';
    sala.nocheDesde = ahora();
    sala.retenido = null;
    iniciarFase(sala);
    cambio(sala);
  }

  function reiniciar(socketId) {
    const { sala, jugador } = buscarPorSocket(socketId);
    if (sala.anfitrionId !== jugador.id) falla('Solo el anfitrión puede reiniciar');
    if (sala.etapa !== 'fin') falla('La partida aún no terminó');
    sala.cancelar?.(); sala.cancelar = null; sala.limite = null;
    sala.jugadores = sala.jugadores.filter((j) => j.conectado);
    sala.juego = null; sala.etapa = 'lobby'; sala.retenido = null;
    cambio(sala);
  }

  function jugar(socketId, accion) {
    const { sala, jugador } = buscarPorSocket(socketId);
    if (sala.etapa !== 'juego') falla('No hay una partida en curso');
    if (sala.retenido) falla('Espera un momento');
    aplicar(sala, jugador.id, accion);
  }

  function aplicar(sala, id, accion) {
    const antes = sala.juego;
    const despues = actuar(antes, id, accion, rng);
    sala.juego = despues;
    const eraNoche = NOCHE.includes(antes.fase);
    const esNoche = NOCHE.includes(despues.fase);
    if (!eraNoche && esNoche) sala.nocheDesde = ahora();
    if (eraNoche && !esNoche) {
      const falta = sala.nocheDesde + tiempos.nocheMin - ahora();
      if (falta > 0) return retener(sala, antes, falta);
    }
    iniciarFase(sala);
    cambio(sala);
  }

  /** Mantiene oculto el resultado de la noche hasta cumplir la duración mínima. */
  function retener(sala, antes, ms) {
    sala.cancelar?.();
    sala.limite = null;
    sala.retenido = { antes };
    sala.cancelar = programar(() => { sala.retenido = null; iniciarFase(sala); cambio(sala); }, ms);
    cambio(sala);
  }

  function iniciarFase(sala) {
    sala.cancelar?.(); sala.cancelar = null; sala.limite = null;
    const e = sala.juego;
    if (e.fase === 'fin') { sala.etapa = 'fin'; return; }
    const ms = tiempos[e.fase];
    if (!ms) return;
    sala.limite = ahora() + ms;
    sala.cancelar = programar(() => vencer(sala), ms);
  }

  /** Se acabó el tiempo: los jugadores que faltan juegan "en automático" para que la partida no se estanque. */
  function vencer(sala) {
    if (sala.etapa !== 'juego' || sala.retenido) return;
    const fase = sala.juego.fase;
    for (const id of pendientes(sala.juego)) {
      if (sala.juego.fase !== fase || sala.retenido) break;
      try { aplicar(sala, id, accionAuto(sala.juego, id)); } catch { /* si falla, se reintenta al reiniciar el reloj */ }
    }
    if (sala.juego.fase === fase && !sala.retenido && sala.etapa === 'juego') { iniciarFase(sala); cambio(sala); }
  }

  function accionAuto(e, id) {
    const elige = (lista) => lista[Math.floor(rng() * lista.length)].id;
    const vivos = e.jugadores.filter((j) => j.vivo);
    switch (e.fase) {
      case 'lobos': return { tipo: 'matar', objetivo: elige(vivos.filter((j) => j.rol !== ROL.LOBO)) };
      case 'vidente': return { tipo: 'ver', objetivo: elige(vivos.filter((j) => j.id !== id)) };
      case 'bruja': return { tipo: 'pocion' };
      case 'cazador': return { tipo: 'disparar', objetivo: elige(vivos) };
      default: return { tipo: 'votar', objetivo: null };
    }
  }

  // ---------- lo que ve cada jugador ----------
  function vistaJuego(sala, id) {
    if (!sala.retenido) return vista(sala.juego, id);
    // Noche retenida: lo público sigue como antes; solo se añade lo privado que acaba de averiguar el jugador.
    const base = vista(sala.retenido.antes, id);
    const priv = vista(sala.juego, id);
    const v = { ...base, fase: 'noche', puedeActuar: false };
    delete v.victimaDeLosLobos; delete v.votosLobos;
    if (priv.vistos) v.vistos = priv.vistos;
    if (priv.pociones) v.pociones = priv.pociones;
    return v;
  }

  function vistaDe(sala, id) {
    const salaJugadores = sala.jugadores.map((j) => ({ id: j.id, nombre: j.nombre, conectado: j.conectado, anfitrion: j.id === sala.anfitrionId }));
    const base = { codigo: sala.codigo, yo: id, etapa: sala.etapa, anfitrionId: sala.anfitrionId, jugadoresSala: salaJugadores, minimo: MIN_JUGADORES, maximo: MAX_JUGADORES };
    if (!sala.juego) return base;
    const v = vistaJuego(sala, id);
    v.jugadores = v.jugadores.map((j) => ({ ...j, conectado: sala.jugadores.find((x) => x.id === j.id)?.conectado ?? false }));
    if (v.fase !== 'noche' && sala.limite) v.temporizador = { restanteMs: Math.max(0, sala.limite - ahora()) };
    return { ...base, juego: v };
  }

  /** Para cada jugador conectado de la sala: a qué socket enviar qué vista. */
  function entregas(sala) {
    return sala.jugadores.filter((j) => j.socketId).map((j) => ({ socketId: j.socketId, vista: vistaDe(sala, j.id) }));
  }

  function limpiar() {
    for (const sala of salas.values()) {
      if (!sala.jugadores.some((j) => j.conectado) && ahora() - sala.ultimaActividad > tiempos.salaInactiva) destruir(sala);
    }
  }

  return {
    crear, unirse, reconectar, salir, empezar, reiniciar, jugar, desconectar: desvincularSocket,
    entregas, limpiar, sala: (codigo) => salas.get(codigo), cantidadSalas: () => salas.size,
  };
}

module.exports = { crearGestor, rolesDesdeConfig, TIEMPOS };
