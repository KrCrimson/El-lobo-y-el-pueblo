'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearGestor, rolesDesdeConfig, TIEMPOS } = require('./salas');

// Reloj falso: los temporizadores solo avanzan cuando la prueba lo pide.
function reloj() {
  let t = 1000; const tareas = [];
  return {
    ahora: () => t,
    programar: (fn, ms) => { const x = { fn, en: t + ms, viva: true }; tareas.push(x); return () => { x.viva = false; }; },
    avanzar(ms) {
      const fin = t + ms;
      for (;;) {
        const sig = tareas.filter((x) => x.viva && x.en <= fin).sort((a, b) => a.en - b.en)[0];
        if (!sig) break;
        sig.viva = false; t = sig.en; sig.fn();
      }
      t = fin;
    },
  };
}
const tok = (n) => `token-de-prueba-${String(n).padStart(4, '0')}`;

/** Sala con n jugadores conectados (s0 = anfitrión). rng fijo: el reparto no se mezcla, así p0 es el lobo. */
function montar(n) {
  const r = reloj();
  const g = crearGestor({ ahora: r.ahora, programar: r.programar, rng: () => 0.9999 });
  const { codigo } = g.crear({ socketId: 's0', nombre: 'Ana', token: tok(0) });
  for (let i = 1; i < n; i++) g.unirse({ socketId: `s${i}`, codigo, nombre: `J${i}`, token: tok(i) });
  const ver = (i) => g.entregas(g.sala(codigo)).find((e) => e.socketId === `s${i}`).vista;
  return { g, r, codigo, ver };
}
const SOLO_LOBO = { lobos: 1 }; // roles = [lobo, aldeano, aldeano, ...]

test('crear y unirse: código de 4 letras, nombres únicos y límites', () => {
  const { g, codigo } = montar(3);
  assert.match(codigo, /^[A-Z]{4}$/);
  assert.throws(() => g.unirse({ socketId: 'x', codigo, nombre: 'ana', token: tok(99) }), /ese nombre/);
  assert.throws(() => g.unirse({ socketId: 'x', codigo: 'QQQQ', nombre: 'Z', token: tok(99) }), /no existe/);
  assert.throws(() => g.unirse({ socketId: 'x', codigo: 'xx', nombre: 'Z', token: tok(99) }), /Código/);
  assert.throws(() => g.unirse({ socketId: 'x', codigo, nombre: '   ', token: tok(99) }), /nombre/);
  assert.throws(() => g.unirse({ socketId: 'x', codigo, nombre: 'Z', token: 'corto' }), /Sesión/);
  assert.throws(() => g.crear({ socketId: 'x', nombre: 'a'.repeat(21), token: tok(98) }), /nombre/);
  for (let i = 3; i < 12; i++) g.unirse({ socketId: `s${i}`, codigo, nombre: `J${i}`, token: tok(i) });
  assert.throws(() => g.unirse({ socketId: 'x', codigo, nombre: 'Extra', token: tok(50) }), /llena/);
});

test('el nombre se limpia de caracteres peligrosos', () => {
  const { g, codigo } = montar(1);
  g.unirse({ socketId: 'sx', codigo, nombre: '  <b>Hugo</b>\n  ', token: tok(7) });
  const nombres = g.entregas(g.sala(codigo))[0].vista.jugadoresSala.map((j) => j.nombre);
  assert.ok(nombres.includes('bHugo/b'), nombres.join(','));
});

test('empezar: solo el anfitrión, con mínimo de jugadores y configuración válida', () => {
  const { g } = montar(4);
  assert.throws(() => g.empezar('s0', SOLO_LOBO), /al menos 5/);
  const m = montar(5);
  assert.throws(() => m.g.empezar('s1', SOLO_LOBO), /Solo el anfitrión/);
  assert.throws(() => m.g.empezar('s0', { lobos: 3 }), /Demasiados lobos/);
  assert.throws(() => m.g.empezar('s0', { lobos: 0 }), /al menos un lobo/);
  m.g.empezar('s0', SOLO_LOBO); // con la configuración válida sí arranca
  assert.equal(m.ver(0).etapa, 'juego');
});

test('rolesDesdeConfig arma la lista pedida o usa el reparto por defecto', () => {
  assert.equal(rolesDesdeConfig(6, undefined), undefined);
  assert.deepEqual(rolesDesdeConfig(6, { lobos: 2, vidente: true }), ['lobo', 'lobo', 'vidente', 'aldeano', 'aldeano', 'aldeano']);
  assert.throws(() => rolesDesdeConfig(3, { lobos: 1, vidente: true, bruja: true, cazador: true }), /más roles/);
});

test('cada jugador recibe solo su vista: sin roles ajenos ni tokens', () => {
  const { g, ver } = montar(6);
  g.empezar('s0', { lobos: 1, vidente: true });
  for (let i = 0; i < 6; i++) {
    const v = ver(i);
    const texto = JSON.stringify(v);
    assert.equal(texto.includes('token-de-prueba'), false, 'se filtró un token');
    for (const j of v.juego.jugadores.filter((x) => x.id !== v.yo)) assert.equal('rol' in j, false, `el jugador ${i} ve el rol de ${j.nombre}`);
  }
  assert.equal(ver(0).juego.yo.rol, 'lobo');
  assert.equal(ver(1).juego.yo.rol, 'vidente');
  assert.equal(ver(2).juego.fase, 'noche'); // un aldeano no sabe en qué subfase está la noche
  assert.equal(ver(0).juego.fase, 'lobos');
});

test('la noche dura al menos lo mínimo aunque no haya vidente ni bruja', () => {
  const { g, r, ver } = montar(5);
  g.empezar('s0', SOLO_LOBO);
  const objetivo = ver(0).juego.jugadores.find((j) => j.id !== ver(0).yo).id;
  g.jugar('s0', { tipo: 'matar', objetivo });
  // el servidor ya procesó la noche, pero no se publica todavía
  assert.equal(ver(2).juego.fase, 'noche');
  assert.equal(ver(2).juego.publico.length, 0);
  assert.equal(ver(2).juego.jugadores.every((j) => j.vivo), true);
  assert.throws(() => g.jugar('s2', { tipo: 'votar', objetivo: null }), /Espera/);
  r.avanzar(TIEMPOS.nocheMin - 1);
  assert.equal(ver(2).juego.fase, 'noche');
  r.avanzar(1);
  assert.equal(ver(2).juego.fase, 'votacion');
  assert.equal(ver(2).juego.publico.filter((p) => p.tipo === 'muerte').length, 1);
});

test('si los jugadores no actúan, el tiempo se agota y la partida avanza sola', () => {
  const { g, r, ver } = montar(5);
  g.empezar('s0', SOLO_LOBO);
  assert.equal(ver(0).juego.temporizador.restanteMs, TIEMPOS.lobos);
  r.avanzar(TIEMPOS.lobos); // el lobo no votó: ataca el servidor por él
  r.avanzar(TIEMPOS.nocheMin);
  assert.equal(ver(1).juego.fase, 'votacion');
  assert.ok(ver(1).juego.temporizador.restanteMs <= TIEMPOS.votacion);
  r.avanzar(TIEMPOS.votacion); // nadie vota: abstención general, empieza otra noche
  assert.equal(ver(0).juego.ronda, 2);
  assert.equal(ver(0).juego.fase, 'lobos');
});

test('una partida desatendida termina sola con un ganador', () => {
  const { g, r, ver } = montar(5);
  g.empezar('s0', SOLO_LOBO);
  for (let i = 0; i < 40 && ver(0).etapa !== 'fin'; i++) r.avanzar(TIEMPOS.votacion + TIEMPOS.nocheMin);
  assert.equal(ver(0).etapa, 'fin');
  assert.equal(ver(0).juego.ganador, 'lobos');
  for (const j of ver(2).juego.jugadores) assert.ok(j.rol, 'al terminar se revelan los roles');
});

test('reconexión: el mismo token recupera el mismo jugador y su rol', () => {
  const { g, codigo, ver } = montar(5);
  g.empezar('s0', SOLO_LOBO);
  g.desconectar('s3');
  assert.equal(ver(0).juego.jugadores.find((j) => j.nombre === 'J3').conectado, false);
  g.reconectar({ socketId: 'nuevo', codigo, token: tok(3) });
  const vNueva = g.entregas(g.sala(codigo)).find((e) => e.socketId === 'nuevo').vista;
  assert.equal(vNueva.juego.yo.nombre, 'J3');
  assert.equal(vNueva.juego.yo.rol, 'aldeano');
  assert.throws(() => g.reconectar({ socketId: 'otro', codigo, token: tok(77) }), /No perteneces/);
  assert.throws(() => g.unirse({ socketId: 'tarde', codigo, nombre: 'Tarde', token: tok(88) }), /ya empezó/);
});

test('el anfitrión pasa a otro jugador conectado si se va, y la sala vacía se borra', () => {
  const { g, r, codigo, ver } = montar(3);
  g.desconectar('s0');
  assert.equal(ver(1).anfitrionId, g.entregas(g.sala(codigo)).find((e) => e.socketId === 's1').vista.jugadoresSala.find((j) => j.nombre === 'J1').id);
  g.salir('s1'); g.salir('s2');
  assert.equal(g.sala(codigo).jugadores.length, 1); // queda Ana, desconectada
  r.avanzar(TIEMPOS.salaInactiva + 1);
  g.limpiar();
  assert.equal(g.cantidadSalas(), 0);
});

test('reiniciar: solo el anfitrión y solo al terminar; vuelve al lobby con los conectados', () => {
  const { g, r, ver } = montar(5);
  g.empezar('s0', SOLO_LOBO);
  assert.throws(() => g.reiniciar('s0'), /aún no terminó/);
  for (let i = 0; i < 40 && ver(0).etapa !== 'fin'; i++) r.avanzar(TIEMPOS.votacion + TIEMPOS.nocheMin);
  assert.throws(() => g.reiniciar('s1'), /Solo el anfitrión/);
  g.desconectar('s4');
  g.reiniciar('s0');
  assert.equal(ver(0).etapa, 'lobby');
  assert.equal(ver(0).jugadoresSala.length, 4);
  assert.equal('juego' in ver(0), false);
});

test('acciones fuera de lugar', () => {
  const { g } = montar(5);
  assert.throws(() => g.jugar('s0', { tipo: 'matar', objetivo: 'x' }), /No hay una partida/);
  assert.throws(() => g.jugar('desconocido', {}), /No estás/);
  g.empezar('s0', SOLO_LOBO);
  assert.throws(() => g.empezar('s0', SOLO_LOBO), /ya empezó/);
  assert.throws(() => g.jugar('s1', { tipo: 'matar', objetivo: 'x' }), /Solo los lobos/);
});
