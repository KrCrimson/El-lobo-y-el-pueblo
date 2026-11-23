'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROL, crearPartida, actuar, vista, pendientes, rolesPorDefecto } = require('./juego');

const SIN_MEZCLA = () => 0.9999; // el reparto queda en el orden dado: p0 = roles[0], p1 = roles[1]…
const L = ROL.LOBO, A = ROL.ALDEANO, V = ROL.VIDENTE, B = ROL.BRUJA, C = ROL.CAZADOR;

const partida = (roles) =>
  crearPartida(roles.map((_, i) => ({ id: `p${i}`, nombre: `Jugador ${i}` })), { roles, rng: SIN_MEZCLA });

const mata = (e, lobo, objetivo, rng) => actuar(e, lobo, { tipo: 'matar', objetivo }, rng);
const votaTodos = (e, objetivo) =>
  pendientes(e).reduce((acc, id) => actuar(acc, id, { tipo: 'votar', objetivo: objetivo ?? null }), e);
const eventos = (e, tipo) => e.publico.filter((x) => x.tipo === tipo);
const vivosIds = (e) => e.jugadores.filter((j) => j.vivo).map((j) => j.id);

// ---------- creación y reparto ----------
test('reparto por defecto: un rol por jugador, al menos un lobo y menos lobos que la mitad', () => {
  for (let n = 5; n <= 12; n++) {
    const roles = rolesPorDefecto(n);
    assert.equal(roles.length, n);
    const lobos = roles.filter((r) => r === L).length;
    assert.ok(lobos >= 1 && lobos < n / 2, `n=${n} lobos=${lobos}`);
    for (const unico of [V, B, C]) assert.ok(roles.filter((r) => r === unico).length <= 1);
  }
});

test('rechaza partidas inválidas', () => {
  const js = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nombre: `J${i}` }));
  assert.throws(() => crearPartida(js(4)), /5 a 12/);
  assert.throws(() => crearPartida(js(13)), /5 a 12/);
  assert.throws(() => crearPartida([...js(4), { id: 'p0', nombre: 'otra' }]), /repetidos/);
  assert.throws(() => crearPartida(js(5), { roles: [A, A, A, A, A] }), /al menos un lobo/);
  assert.throws(() => crearPartida(js(5), { roles: [L, L, L, L, L] }), /no sea lobo/);
  assert.throws(() => crearPartida(js(5), { roles: [L, V, V, A, A] }), /Solo puede haber un vidente/);
  assert.throws(() => crearPartida(js(5), { roles: [L, 'dragon', A, A, A] }), /Rol desconocido/);
  assert.throws(() => crearPartida(js(5), { roles: [L, A, A] }), /un rol por jugador/);
});

test('el reparto depende del rng y conserva la cantidad de cada rol', () => {
  const js = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, nombre: `J${i}` }));
  const a = crearPartida(js, { rng: () => 0 });
  const b = crearPartida(js, { rng: () => 0.5 });
  assert.notDeepEqual(a.jugadores.map((j) => j.rol), b.jugadores.map((j) => j.rol));
  assert.deepEqual(a.jugadores.map((j) => j.rol).sort(), [...rolesPorDefecto(8)].sort());
  assert.equal(a.fase, 'lobos');
  assert.equal(a.ronda, 1);
});

// ---------- noche ----------
test('noche completa: lobos → vidente → bruja que cura → sin muertes', () => {
  let e = partida([L, V, B, A, A, A]);
  assert.deepEqual(pendientes(e), ['p0']);
  e = mata(e, 'p0', 'p3');
  assert.equal(e.fase, 'vidente');
  e = actuar(e, 'p1', { tipo: 'ver', objetivo: 'p0' });
  assert.equal(e.fase, 'bruja');
  assert.equal(vista(e, 'p2').victimaDeLosLobos, 'p3');
  e = actuar(e, 'p2', { tipo: 'pocion', curar: true });
  assert.equal(e.fase, 'votacion');
  assert.equal(eventos(e, 'sin_muertes').length, 1);
  assert.equal(vista(e, 'p2').pociones.pocionVida, false);
  assert.deepEqual(vista(e, 'p1').vistos, [{ id: 'p0', rol: L }]);
  assert.equal(vista(e, 'p2').victimaDeLosLobos, undefined); // ya no es su fase
});

test('sin vidente ni bruja la noche salta directo al amanecer', () => {
  let e = partida([L, A, A, A, A]);
  e = mata(e, 'p0', 'p1');
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(eventos(e, 'muerte').map((m) => [m.jugador, m.rol, m.causa]), [['p1', A, 'lobos']]);
});

test('la bruja puede envenenar; si veneno y lobos eligen al mismo, muere una sola vez', () => {
  let e = partida([L, V, B, A, A, A, A]);
  e = mata(e, 'p0', 'p3');
  e = actuar(e, 'p1', { tipo: 'ver', objetivo: 'p3' });
  e = actuar(e, 'p2', { tipo: 'pocion', envenenar: 'p4' });
  assert.deepEqual(eventos(e, 'muerte').map((m) => [m.jugador, m.causa]), [['p3', 'lobos'], ['p4', 'veneno']]);

  let f = partida([L, V, B, A, A, A, A]);
  f = mata(f, 'p0', 'p3');
  f = actuar(f, 'p1', { tipo: 'ver', objetivo: 'p3' });
  f = actuar(f, 'p2', { tipo: 'pocion', envenenar: 'p3' });
  assert.equal(eventos(f, 'muerte').length, 1);
});

test('curar y envenenar en la misma noche: solo muere el envenenado', () => {
  let e = partida([L, V, B, A, A, A, A]);
  e = mata(e, 'p0', 'p3');
  e = actuar(e, 'p1', { tipo: 'ver', objetivo: 'p3' });
  e = actuar(e, 'p2', { tipo: 'pocion', curar: true, envenenar: 'p4' });
  assert.deepEqual(eventos(e, 'muerte').map((m) => m.jugador), ['p4']);
});

test('cada poción solo se usa una vez y la bruja no actúa si ya no le quedan', () => {
  let e = partida([L, V, B, A, A, A, A, A]);
  e = mata(e, 'p0', 'p3');
  e = actuar(e, 'p1', { tipo: 'ver', objetivo: 'p0' });
  e = actuar(e, 'p2', { tipo: 'pocion', curar: true, envenenar: 'p4' });
  e = votaTodos(e); // nadie muere de día
  assert.equal(e.fase, 'lobos');
  e = mata(e, 'p0', 'p5');
  e = actuar(e, 'p1', { tipo: 'ver', objetivo: 'p5' });
  assert.equal(e.fase, 'votacion'); // sin pociones la bruja se salta y amanece
});

test('empate entre lobos lo decide el rng y la fase no avanza hasta que voten todos', () => {
  let e = partida([L, L, V, A, A, A, A, A]);
  e = mata(e, 'p0', 'p3');
  assert.equal(e.fase, 'lobos');
  assert.deepEqual(pendientes(e), ['p1']);
  e = mata(e, 'p1', 'p4', () => 0);
  assert.equal(e.fase, 'vidente');
  assert.equal(e.noche.victima, 'p3'); // rng=0 → primer empatado
  let f = partida([L, L, V, A, A, A, A, A]);
  f = mata(f, 'p0', 'p3');
  f = mata(f, 'p1', 'p4', () => 0.99);
  assert.equal(f.noche.victima, 'p4');
});

test('acciones inválidas', () => {
  const e = partida([L, L, V, B, A, A]);
  assert.throws(() => mata(e, 'p2', 'p4'), /Solo los lobos/);
  assert.throws(() => mata(e, 'p0', 'p1'), /otro lobo/);
  assert.throws(() => mata(e, 'p0', 'nadie'), /objetivo no es válido/);
  assert.throws(() => actuar(e, 'p0', { tipo: 'votar', objetivo: 'p4' }), /no válida/);
  assert.throws(() => actuar(e, 'p0', null), /no válida/);
  assert.throws(() => actuar(e, 'fantasma', { tipo: 'matar', objetivo: 'p4' }), /desconocido/);

  let n = mata(mata(e, 'p0', 'p4'), 'p1', 'p4');
  assert.equal(n.fase, 'vidente');
  assert.throws(() => actuar(n, 'p2', { tipo: 'ver', objetivo: 'p2' }), /a ti misma/);
  assert.throws(() => actuar(n, 'p3', { tipo: 'ver', objetivo: 'p0' }), /Solo la vidente/);
  n = actuar(n, 'p2', { tipo: 'ver', objetivo: 'p0' });
  assert.throws(() => actuar(n, 'p3', { tipo: 'pocion', envenenar: 'p3' }), /a ti misma/);
  assert.throws(() => actuar(n, 'p4', { tipo: 'pocion' }), /Solo la bruja/);
});

test('un muerto no puede actuar y el estado original no se modifica', () => {
  let e = partida([L, A, A, A, A, A]);
  const antes = structuredClone(e);
  const e2 = mata(e, 'p0', 'p1');
  assert.deepEqual(e, antes);
  assert.throws(() => actuar(e2, 'p1', { tipo: 'votar', objetivo: 'p0' }), /muerto/);
});

// ---------- votación ----------
test('votación: mayoría linchada con su rol revelado; solo se resuelve cuando votan todos', () => {
  let e = partida([L, A, A, A, A, A]);
  e = mata(e, 'p0', 'p5'); // quedan p0..p4
  e = actuar(e, 'p1', { tipo: 'votar', objetivo: 'p0' });
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(vista(e, 'p3').yaVotaron, ['p1']);
  e = actuar(e, 'p1', { tipo: 'votar', objetivo: 'p2' }); // puede cambiar su voto
  e = actuar(e, 'p2', { tipo: 'votar', objetivo: 'p0' });
  e = actuar(e, 'p3', { tipo: 'votar', objetivo: 'p0' });
  e = actuar(e, 'p4', { tipo: 'votar', objetivo: 'p0' });
  e = actuar(e, 'p0', { tipo: 'votar', objetivo: 'p1' });
  assert.equal(e.fase, 'fin');
  assert.equal(e.ganador, 'pueblo');
  const m = eventos(e, 'muerte').find((x) => x.causa === 'votacion');
  assert.deepEqual([m.jugador, m.rol], ['p0', L]);
});

test('empate o abstención: nadie muere y empieza la siguiente noche', () => {
  let e = partida([L, A, A, A, A, A]);
  e = mata(e, 'p0', 'p5');
  e = actuar(e, 'p1', { tipo: 'votar', objetivo: 'p2' });
  e = actuar(e, 'p2', { tipo: 'votar', objetivo: 'p1' });
  e = actuar(e, 'p3', { tipo: 'votar' });
  e = actuar(e, 'p4', { tipo: 'votar', objetivo: null });
  e = actuar(e, 'p0', { tipo: 'votar', objetivo: 'p3' });
  assert.equal(eventos(e, 'sin_linchamiento').length, 1);
  assert.equal(e.fase, 'lobos');
  assert.equal(e.ronda, 2);
  assert.deepEqual(e.votos, {});
});

// ---------- cazador ----------
test('cazador muerto de noche dispara antes de la votación', () => {
  let e = partida([L, A, A, A, C, A]);
  e = mata(e, 'p0', 'p4');
  assert.equal(e.fase, 'cazador');
  assert.deepEqual(pendientes(e), ['p4']);
  assert.throws(() => actuar(e, 'p1', { tipo: 'disparar', objetivo: 'p0' }), /Solo el cazador/);
  e = actuar(e, 'p4', { tipo: 'disparar', objetivo: 'p1' }); // muerto, pero puede disparar
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(vivosIds(e), ['p0', 'p2', 'p3', 'p5']);
});

test('el cazador puede ganar la partida con su disparo', () => {
  let e = partida([L, A, A, A, C]);
  e = mata(e, 'p0', 'p4');
  e = actuar(e, 'p4', { tipo: 'disparar', objetivo: 'p0' });
  assert.equal(e.fase, 'fin');
  assert.equal(e.ganador, 'pueblo');
});

test('cazador linchado dispara y la partida sigue con la noche siguiente', () => {
  let e = partida([L, A, A, A, C, A, A]);
  e = mata(e, 'p0', 'p5');
  e = votaTodos(e, 'p4');
  assert.equal(e.fase, 'cazador');
  e = actuar(e, 'p4', { tipo: 'disparar', objetivo: 'p1' });
  assert.equal(e.fase, 'lobos');
  assert.equal(e.ronda, 2);
  assert.deepEqual(vivosIds(e), ['p0', 'p2', 'p3', 'p6']);
});

// ---------- victoria ----------
test('ganan los lobos al igualar a los aldeanos y la partida queda cerrada', () => {
  let e = partida([L, A, A, A, A]);
  e = mata(e, 'p0', 'p1'); e = votaTodos(e);
  e = mata(e, 'p0', 'p2'); e = votaTodos(e);
  e = mata(e, 'p0', 'p3');
  assert.equal(e.fase, 'fin');
  assert.equal(e.ganador, 'lobos');
  assert.equal(eventos(e, 'fin').length, 1);
  assert.deepEqual(pendientes(e), []);
  assert.throws(() => actuar(e, 'p4', { tipo: 'votar', objetivo: 'p0' }), /ya terminó/);
  assert.throws(() => actuar(e, 'p0', { tipo: 'matar', objetivo: 'p4' }), /ya terminó/);
});

// ---------- privacidad: lo que ve cada jugador ----------
test('la vista no filtra roles ni acciones secretas ajenas', () => {
  const e = partida([L, L, V, B, A, A, A, A]);
  const aldeano = vista(e, 'p4');
  assert.equal(aldeano.yo.rol, A);
  for (const j of aldeano.jugadores.filter((x) => x.id !== 'p4')) assert.equal('rol' in j, false, `se filtró el rol de ${j.id}`);
  for (const secreto of ['companerosLobo', 'votosLobos', 'vistos', 'pociones', 'victimaDeLosLobos']) {
    assert.equal(secreto in aldeano, false, `un aldeano ve ${secreto}`);
  }
  assert.equal(JSON.stringify(aldeano).includes('"lobo"'), false);

  const lobo = vista(e, 'p0');
  assert.deepEqual(lobo.companerosLobo, ['p1']);
  assert.equal('vistos' in lobo || 'pociones' in lobo, false);
  assert.equal(lobo.jugadores.find((j) => j.id === 'p1').rol, undefined); // lo conoce por companerosLobo, no por la lista

  assert.deepEqual(vista(e, 'p2').vistos, []);
  assert.deepEqual(vista(e, 'p3').pociones, { pocionVida: true, pocionMuerte: true });
});

test('la fase de noche solo se detalla a quien debe actuar (no delata qué roles viven)', () => {
  let e = partida([L, V, B, A, A, A]);
  assert.equal(vista(e, 'p0').fase, 'lobos');
  assert.equal(vista(e, 'p3').fase, 'noche');
  assert.equal(vista(e, 'p1').fase, 'noche'); // la vidente aún no es su turno
  e = mata(e, 'p0', 'p3');
  assert.equal(vista(e, 'p1').fase, 'vidente');
  assert.equal(vista(e, 'p0').fase, 'noche'); // el lobo ya actuó
  assert.equal(vista(e, 'p4').fase, 'noche');
  // misma vista para un aldeano en una partida con y sin vidente
  const sin = mata(partida([L, A, A, A, A, A]), 'p0', 'p1');
  assert.equal(vista(partida([L, A, A, A, A, A]), 'p3').fase, vista(partida([L, V, B, A, A, A]), 'p3').fase);
  assert.equal(sin.fase, 'votacion');
});

test('los votos de los lobos solo los ven los lobos', () => {
  let e = partida([L, L, V, A, A, A, A, A]);
  e = mata(e, 'p0', 'p3');
  assert.deepEqual(vista(e, 'p1').votosLobos, { p0: 'p3' });
  assert.equal('votosLobos' in vista(e, 'p5'), false);
  assert.equal('votosLobos' in vista(e, 'p2'), false);
});

test('los muertos revelan su rol y al terminar se revelan todos', () => {
  let e = partida([L, V, A, A, A]);
  e = mata(e, 'p0', 'p2');
  e = actuar(e, 'p1', { tipo: 'ver', objetivo: 'p0' });
  assert.equal(vista(e, 'p4').jugadores.find((j) => j.id === 'p2').rol, A);
  assert.equal('rol' in vista(e, 'p4').jugadores.find((j) => j.id === 'p1'), false);
  e = votaTodos(e, 'p0');
  assert.equal(e.fase, 'fin');
  for (const j of vista(e, 'p4').jugadores) assert.ok(j.rol, `falta el rol de ${j.id} al terminar`);
});

// ---------- simulación ----------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function accionAleatoria(e, id, rng) {
  const yo = e.jugadores.find((j) => j.id === id);
  const otros = e.jugadores.filter((j) => j.vivo && j.id !== id);
  const elige = (arr) => arr[Math.floor(rng() * arr.length)].id;
  switch (e.fase) {
    case 'lobos': return { tipo: 'matar', objetivo: elige(e.jugadores.filter((j) => j.vivo && j.rol !== L)) };
    case 'vidente': return { tipo: 'ver', objetivo: elige(otros) };
    case 'bruja': {
      const a = { tipo: 'pocion' };
      if (e.bruja.pocionVida && e.noche.victima && rng() < 0.5) a.curar = true;
      if (e.bruja.pocionMuerte && rng() < 0.5) a.envenenar = elige(otros);
      return a;
    }
    case 'cazador': return { tipo: 'disparar', objetivo: elige(e.jugadores.filter((j) => j.vivo)) };
    case 'votacion': return { tipo: 'votar', objetivo: rng() < 0.2 ? null : elige(e.jugadores.filter((j) => j.vivo)) };
    default: throw new Error(`fase inesperada ${yo.rol}`);
  }
}

test('300 partidas simuladas con jugadores aleatorios terminan con un ganador válido', () => {
  for (let semilla = 1; semilla <= 300; semilla++) {
    const rng = mulberry32(semilla);
    const n = 5 + Math.floor(rng() * 8);
    let e = crearPartida(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nombre: `J${i}` })), { rng });
    let pasos = 0;
    while (e.fase !== 'fin') {
      assert.ok(++pasos < 2000, `semilla ${semilla}: la partida no termina`);
      const quienes = pendientes(e);
      assert.ok(quienes.length > 0, `semilla ${semilla}: nadie puede actuar en la fase ${e.fase}`);
      e = actuar(e, quienes[0], accionAleatoria(e, quienes[0], rng), rng);
      const lobos = e.jugadores.filter((j) => j.vivo && j.rol === L).length;
      const resto = e.jugadores.filter((j) => j.vivo).length - lobos;
      if (e.fase !== 'fin') assert.ok(lobos > 0 && lobos < resto, `semilla ${semilla}: estado inconsistente`);
    }
    assert.ok(['pueblo', 'lobos'].includes(e.ganador));
  }
});
