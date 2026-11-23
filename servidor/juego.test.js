'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROL, crearPartida, actuar, vista, pendientes, rolesPorDefecto } = require('./juego');

const SIN_MEZCLA = () => 0.9999; // el reparto queda en el orden dado: p0 = roles[0], p1 = roles[1]…
const L = ROL.LOBO, A = ROL.ALDEANO, V = ROL.VIDENTE, B = ROL.BRUJA, C = ROL.CAZADOR, U = ROL.CUPIDO;

const partida = (roles, opciones = {}) =>
  crearPartida(roles.map((_, i) => ({ id: `p${i}`, nombre: `Jugador ${i}` })), { roles, rng: SIN_MEZCLA, ...opciones });

const mata = (e, lobo, objetivo, rng) => actuar(e, lobo, { tipo: 'matar', objetivo }, rng);
const ve = (e, vidente, objetivo) => actuar(e, vidente, { tipo: 'ver', objetivo });
const todosVotan = (e, tipo, objetivo) => pendientes(e).reduce((acc, id) => actuar(acc, id, { tipo, objetivo: objetivo ?? null }), e);
const votaTodos = (e, objetivo) => todosVotan(e, 'votar', objetivo);
const eligenCapitan = (e, objetivo) => todosVotan(e, 'elegir', objetivo);
const eventos = (e, tipo) => e.publico.filter((x) => x.tipo === tipo);
const vivosIds = (e) => e.jugadores.filter((j) => j.vivo).map((j) => j.id);
/** Noche completa con p0=lobo, p1=vidente, p2=bruja: el vidente mira, los lobos atacan y la bruja decide. */
const noche3 = (e, { mira = 'p0', ataca = 'p3', pocion = {} } = {}) =>
  actuar(mata(ve(e, 'p1', mira), 'p0', ataca), 'p2', { tipo: 'pocion', ...pocion });

// ---------- creación y reparto ----------
test('reparto por defecto: un rol por jugador, al menos un lobo y menos lobos que la mitad', () => {
  for (let n = 5; n <= 12; n++) {
    const roles = rolesPorDefecto(n);
    assert.equal(roles.length, n);
    const lobos = roles.filter((r) => r === L).length;
    assert.ok(lobos >= 1 && lobos < n / 2, `n=${n} lobos=${lobos}`);
    for (const unico of [V, B, C, U]) assert.ok(roles.filter((r) => r === unico).length <= 1);
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
  assert.throws(() => crearPartida(js(5), { roles: [L, U, U, A, A] }), /Solo puede haber un cupido/);
  assert.throws(() => crearPartida(js(5), { roles: [L, 'dragon', A, A, A] }), /Rol desconocido/);
  assert.throws(() => crearPartida(js(5), { roles: [L, A, A] }), /un rol por jugador/);
});

test('el reparto depende del rng y conserva la cantidad de cada rol', () => {
  const js = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, nombre: `J${i}` }));
  const a = crearPartida(js, { rng: () => 0 });
  const b = crearPartida(js, { rng: () => 0.5 });
  assert.notDeepEqual(a.jugadores.map((j) => j.rol), b.jugadores.map((j) => j.rol));
  assert.deepEqual(a.jugadores.map((j) => j.rol).sort(), [...rolesPorDefecto(8)].sort());
  assert.equal(a.ronda, 1);
});

// ---------- noche ----------
test('orden de la noche: vidente → lobos → bruja → amanecer', () => {
  let e = partida([L, V, B, A, A, A]);
  assert.equal(e.fase, 'vidente');
  assert.deepEqual(pendientes(e), ['p1']);
  e = ve(e, 'p1', 'p0');
  assert.equal(e.fase, 'lobos');
  assert.deepEqual(pendientes(e), ['p0']);
  e = mata(e, 'p0', 'p3');
  assert.equal(e.fase, 'bruja');
  assert.equal(vista(e, 'p2').victimaDeLosLobos, 'p3');
  e = actuar(e, 'p2', { tipo: 'pocion', curar: true });
  assert.equal(e.fase, 'votacion');
  assert.equal(eventos(e, 'sin_muertes').length, 1);
  assert.equal(vista(e, 'p2').pociones.pocionVida, false);
  assert.deepEqual(vista(e, 'p1').vistos, [{ id: 'p0', rol: L }]);
  assert.equal(vista(e, 'p2').victimaDeLosLobos, undefined); // ya no es su fase
});

test('la vidente, aunque sea la víctima de los lobos, ya vio esa noche (actúa antes)', () => {
  let e = partida([L, V, A, A, A]);
  e = ve(e, 'p1', 'p0');
  e = mata(e, 'p0', 'p1');
  assert.deepEqual(vista(e, 'p1').vistos, [{ id: 'p0', rol: L }]);
  assert.equal(e.jugadores[1].vivo, false);
});

test('sin vidente ni bruja la noche salta directo al amanecer', () => {
  let e = partida([L, A, A, A, A]);
  assert.equal(e.fase, 'lobos');
  e = mata(e, 'p0', 'p1');
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(eventos(e, 'muerte').map((m) => [m.jugador, m.rol, m.causa]), [['p1', A, 'lobos']]);
});

test('la bruja puede envenenar; si veneno y lobos eligen al mismo, muere una sola vez', () => {
  const base = partida([L, V, B, A, A, A, A]);
  const e = noche3(base, { pocion: { envenenar: 'p4' } });
  assert.deepEqual(eventos(e, 'muerte').map((m) => [m.jugador, m.causa]), [['p3', 'lobos'], ['p4', 'veneno']]);
  const f = noche3(base, { pocion: { envenenar: 'p3' } });
  assert.equal(eventos(f, 'muerte').length, 1);
});

test('curar y envenenar en la misma noche: solo muere el envenenado', () => {
  const e = noche3(partida([L, V, B, A, A, A, A]), { pocion: { curar: true, envenenar: 'p4' } });
  assert.deepEqual(eventos(e, 'muerte').map((m) => m.jugador), ['p4']);
});

test('cada poción se usa una vez y la bruja se salta sola cuando ya no le quedan', () => {
  let e = noche3(partida([L, V, B, A, A, A, A, A]), { pocion: { curar: true, envenenar: 'p4' } });
  e = votaTodos(e); // nadie muere de día
  assert.equal(e.fase, 'vidente');
  e = mata(ve(e, 'p1', 'p0'), 'p0', 'p5');
  assert.equal(e.fase, 'votacion'); // sin pociones, amanece directo
  assert.equal(vista(e, 'p2').pociones.pocionVida, false);
});

test('empate entre lobos lo decide el rng y la fase no avanza hasta que voten todos', () => {
  const base = ve(partida([L, L, V, A, A, A, A, A]), 'p2', 'p0');
  let e = mata(base, 'p0', 'p3');
  assert.equal(e.fase, 'lobos');
  assert.deepEqual(pendientes(e), ['p1']);
  e = mata(e, 'p1', 'p4', () => 0);
  assert.equal(e.noche.victima, 'p3'); // rng=0 → primer empatado
  assert.equal(eventos(e, 'muerte')[0].jugador, 'p3');
  let f = mata(base, 'p0', 'p3');
  f = mata(f, 'p1', 'p4', () => 0.99);
  assert.equal(f.noche.victima, 'p4');
});

test('acciones inválidas', () => {
  const e0 = partida([L, L, V, B, A, A]);
  assert.throws(() => mata(e0, 'p0', 'p4'), /no válida/); // la noche empieza por la vidente
  assert.throws(() => ve(e0, 'p3', 'p0'), /Solo la vidente/);
  assert.throws(() => ve(e0, 'p2', 'p2'), /a ti misma/);
  assert.throws(() => actuar(e0, 'p0', null), /no válida/);
  assert.throws(() => actuar(e0, 'fantasma', { tipo: 'ver', objetivo: 'p4' }), /desconocido/);

  const e1 = ve(e0, 'p2', 'p0');
  assert.throws(() => mata(e1, 'p2', 'p4'), /Solo los lobos/);
  assert.throws(() => mata(e1, 'p0', 'p1'), /otro lobo/);
  assert.throws(() => mata(e1, 'p0', 'nadie'), /objetivo no es válido/);
  assert.throws(() => actuar(e1, 'p0', { tipo: 'votar', objetivo: 'p4' }), /no válida/);

  const e2 = mata(mata(e1, 'p0', 'p4'), 'p1', 'p4');
  assert.equal(e2.fase, 'bruja');
  assert.throws(() => actuar(e2, 'p3', { tipo: 'pocion', envenenar: 'p3' }), /a ti misma/);
  assert.throws(() => actuar(e2, 'p4', { tipo: 'pocion' }), /Solo la bruja/);
});

test('un muerto no puede actuar y el estado original no se modifica', () => {
  const e = partida([L, A, A, A, A, A]);
  const antes = structuredClone(e);
  const e2 = mata(e, 'p0', 'p1');
  assert.deepEqual(e, antes);
  assert.throws(() => actuar(e2, 'p1', { tipo: 'votar', objetivo: 'p0' }), /muerto/);
});

// ---------- votación ----------
test('votación: mayoría linchada; solo se resuelve cuando votan todos', () => {
  let e = mata(partida([L, A, A, A, A, A]), 'p0', 'p5'); // quedan p0..p4
  e = actuar(e, 'p1', { tipo: 'votar', objetivo: 'p0' });
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(vista(e, 'p3').yaVotaron, ['p1']);
  e = actuar(e, 'p1', { tipo: 'votar', objetivo: 'p2' }); // puede cambiar su voto
  for (const id of ['p2', 'p3', 'p4']) e = actuar(e, id, { tipo: 'votar', objetivo: 'p0' });
  e = actuar(e, 'p0', { tipo: 'votar', objetivo: 'p1' });
  assert.equal(e.fase, 'fin');
  assert.equal(e.ganador, 'pueblo');
  const m = eventos(e, 'muerte').find((x) => x.causa === 'votacion');
  assert.deepEqual([m.jugador, m.rol], ['p0', L]);
});

test('empate o abstención: nadie muere y empieza la siguiente noche', () => {
  let e = mata(partida([L, A, A, A, A, A]), 'p0', 'p5');
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
  let e = mata(partida([L, A, A, A, C, A]), 'p0', 'p4');
  assert.equal(e.fase, 'cazador');
  assert.deepEqual(pendientes(e), ['p4']);
  assert.throws(() => actuar(e, 'p1', { tipo: 'disparar', objetivo: 'p0' }), /Solo el cazador/);
  e = actuar(e, 'p4', { tipo: 'disparar', objetivo: 'p1' }); // muerto, pero puede disparar
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(vivosIds(e), ['p0', 'p2', 'p3', 'p5']);
});

test('el cazador puede ganar la partida con su disparo', () => {
  let e = mata(partida([L, A, A, A, C]), 'p0', 'p4');
  e = actuar(e, 'p4', { tipo: 'disparar', objetivo: 'p0' });
  assert.equal(e.fase, 'fin');
  assert.equal(e.ganador, 'pueblo');
});

test('cazador linchado dispara y la partida sigue con la noche siguiente', () => {
  let e = mata(partida([L, A, A, A, C, A, A]), 'p0', 'p5');
  e = votaTodos(e, 'p4');
  assert.equal(e.fase, 'cazador');
  e = actuar(e, 'p4', { tipo: 'disparar', objetivo: 'p1' });
  assert.equal(e.fase, 'lobos');
  assert.equal(e.ronda, 2);
  assert.deepEqual(vivosIds(e), ['p0', 'p2', 'p3', 'p6']);
});

// ---------- cupido ----------
test('cupido actúa primero la noche 1, los enamorados se conocen y solo ocurre una vez', () => {
  let e = partida([U, V, L, A, A, A]);
  assert.equal(e.fase, 'cupido');
  assert.deepEqual(pendientes(e), ['p0']);
  assert.throws(() => actuar(e, 'p0', { tipo: 'enamorar', objetivos: ['p3', 'p3'] }), /dos jugadores distintos/);
  assert.throws(() => actuar(e, 'p0', { tipo: 'enamorar', objetivos: ['p3'] }), /dos jugadores distintos/);
  assert.throws(() => actuar(e, 'p0', { tipo: 'enamorar', objetivos: ['p3', 'nadie'] }), /objetivo no es válido/);
  assert.throws(() => actuar(e, 'p3', { tipo: 'enamorar', objetivos: ['p3', 'p4'] }), /Solo Cupido/);
  e = actuar(e, 'p0', { tipo: 'enamorar', objetivos: ['p3', 'p4'] });
  assert.equal(e.fase, 'vidente');
  assert.equal(vista(e, 'p3').enamoradoCon, 'p4');
  assert.equal(vista(e, 'p4').enamoradoCon, 'p3');
  assert.deepEqual(vista(e, 'p0').enamorados, ['p3', 'p4']);
  for (const id of ['p1', 'p2', 'p5']) {
    assert.equal('enamoradoCon' in vista(e, id) || 'enamorados' in vista(e, id), false, `${id} no debe saber quiénes son`);
  }
  e = mata(ve(e, 'p1', 'p2'), 'p2', 'p5');
  e = votaTodos(e);
  assert.equal(e.ronda, 2);
  assert.equal(e.fase, 'vidente'); // en la noche 2 ya no hay cupido
});

test('si muere un enamorado, muere también su pareja (y el registro lo muestra como amor)', () => {
  let e = partida([U, V, L, A, A, A, A]);
  e = actuar(e, 'p0', { tipo: 'enamorar', objetivos: ['p3', 'p4'] });
  e = mata(ve(e, 'p1', 'p2'), 'p2', 'p3');
  assert.deepEqual(eventos(e, 'muerte').map((m) => [m.jugador, m.causa]), [['p3', 'lobos'], ['p4', 'amor']]);
  assert.deepEqual(vista(e, 'p5').publico.filter((x) => x.tipo === 'muerte').map((m) => m.causa), ['noche', 'amor']);
});

test('si la pareja del cazador muere de amor, el cazador igualmente dispara', () => {
  let e = partida([U, C, L, A, A, A, A, A]);
  e = actuar(e, 'p0', { tipo: 'enamorar', objetivos: ['p3', 'p1'] });
  e = mata(e, 'p2', 'p3'); // sin vidente ni bruja: la noche sigue con los lobos
  assert.equal(e.fase, 'cazador');
  assert.deepEqual(pendientes(e), ['p1']);
  e = actuar(e, 'p1', { tipo: 'disparar', objetivo: 'p2' });
  assert.equal(e.ganador, 'pueblo');
});

// ---------- capitán ----------
test('capitán: sin la opción, el día empieza directo con la votación', () => {
  const e = mata(partida([L, A, A, A, A, A]), 'p0', 'p1');
  assert.equal(e.fase, 'votacion');
});

test('capitán: lo elige el pueblo el primer día', () => {
  let e = mata(partida([L, A, A, A, A, A], { capitan: true }), 'p0', 'p1');
  assert.equal(e.fase, 'capitan');
  assert.equal(e.capitan, null);
  e = eligenCapitan(e, 'p2');
  assert.equal(e.capitan, 'p2');
  assert.equal(e.fase, 'votacion');
  assert.deepEqual(eventos(e, 'capitan').map((c) => c.jugador), ['p2']);
  assert.equal(vista(e, 'p4').capitan, 'p2');
});

test('capitán: empate lo decide el azar y si todos se abstienen no hay capitán', () => {
  const dia = () => mata(partida([L, A, A, A, A, A], { capitan: true }), 'p0', 'p1'); // vivos: p0, p2..p5
  let e = dia();
  for (const [id, objetivo] of [['p0', 'p2'], ['p2', 'p3'], ['p3', 'p2'], ['p4', 'p3'], ['p5', 'p4']]) e = actuar(e, id, { tipo: 'elegir', objetivo }, () => 0);
  assert.equal(e.capitan, 'p2'); // p2 y p3 empatan con 2; rng=0 → el primero
  let f = dia();
  f = eligenCapitan(f, null);
  assert.equal(f.capitan, null);
  assert.equal(eventos(f, 'sin_capitan').length, 1);
  assert.equal(f.fase, 'votacion');
});

test('capitán: solo se elige el primer día', () => {
  let e = mata(partida([L, A, A, A, A, A], { capitan: true }), 'p0', 'p1');
  e = eligenCapitan(e, null); // nadie
  e = votaTodos(e); // sin linchamiento
  e = mata(e, 'p0', 'p2');
  assert.equal(e.ronda, 2);
  assert.equal(e.fase, 'votacion');
});

test('capitán: su voto vale doble', () => {
  let e = mata(partida([L, A, A, A, A, A, A], { capitan: true }), 'p0', 'p1'); // vivos: p0, p2..p6
  e = eligenCapitan(e, 'p2');
  e = actuar(e, 'p2', { tipo: 'votar', objetivo: 'p4' }); // vale 2
  e = actuar(e, 'p0', { tipo: 'votar', objetivo: 'p4' });
  e = actuar(e, 'p3', { tipo: 'votar', objetivo: 'p5' });
  e = actuar(e, 'p4', { tipo: 'votar', objetivo: 'p5' });
  e = actuar(e, 'p5', { tipo: 'votar', objetivo: null });
  e = actuar(e, 'p6', { tipo: 'votar', objetivo: null });
  assert.deepEqual(eventos(e, 'recuento')[0].votos, { p4: 3, p5: 2 });
  assert.equal(e.jugadores[4].vivo, false);
});

test('capitán: si aun así hay empate, decide su voto', () => {
  let e = mata(partida([L, A, A, A, A, A, A], { capitan: true }), 'p0', 'p1');
  e = eligenCapitan(e, 'p2');
  e = actuar(e, 'p2', { tipo: 'votar', objetivo: 'p3' }); // 2
  e = actuar(e, 'p0', { tipo: 'votar', objetivo: 'p5' });
  e = actuar(e, 'p4', { tipo: 'votar', objetivo: 'p5' }); // p5 también 2
  e = actuar(e, 'p3', { tipo: 'votar', objetivo: null });
  e = actuar(e, 'p5', { tipo: 'votar', objetivo: null });
  e = actuar(e, 'p6', { tipo: 'votar', objetivo: null });
  assert.equal(e.jugadores[3].vivo, false); // gana el que votó el capitán
  assert.equal(e.jugadores[5].vivo, true);
});

test('capitán: al morir nombra a su sucesor', () => {
  let e = mata(partida([L, A, A, A, A, A, A], { capitan: true }), 'p0', 'p1');
  e = eligenCapitan(e, 'p2');
  e = votaTodos(e, 'p2'); // linchan al capitán
  assert.equal(e.fase, 'sucesor');
  assert.deepEqual(pendientes(e), ['p2']);
  assert.throws(() => actuar(e, 'p3', { tipo: 'sucesor', objetivo: 'p4' }), /Solo el capitán/);
  assert.throws(() => actuar(e, 'p2', { tipo: 'sucesor', objetivo: 'p2' }), /objetivo no es válido/);
  e = actuar(e, 'p2', { tipo: 'sucesor', objetivo: 'p3' }); // muerto, pero puede nombrar
  assert.equal(e.capitan, 'p3');
  assert.equal(e.fase, 'lobos');
  assert.equal(e.ronda, 2);
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
});

// ---------- privacidad: lo que ve cada jugador ----------
test('la vista no filtra roles ni acciones secretas ajenas', () => {
  const e = partida([L, L, V, B, A, A, A, A]);
  const aldeano = vista(e, 'p4');
  assert.equal(aldeano.yo.rol, A);
  for (const j of aldeano.jugadores.filter((x) => x.id !== 'p4')) assert.equal('rol' in j, false, `se filtró el rol de ${j.id}`);
  for (const secreto of ['companerosLobo', 'votosLobos', 'vistos', 'pociones', 'victimaDeLosLobos', 'enamoradoCon', 'enamorados']) {
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
  assert.equal(vista(e, 'p1').fase, 'vidente');
  for (const id of ['p0', 'p2', 'p3']) assert.equal(vista(e, id).fase, 'noche');
  e = ve(e, 'p1', 'p0');
  assert.equal(vista(e, 'p0').fase, 'lobos');
  assert.equal(vista(e, 'p1').fase, 'noche'); // la vidente ya actuó
  e = mata(e, 'p0', 'p3');
  assert.equal(vista(e, 'p2').fase, 'bruja');
  assert.equal(vista(e, 'p0').fase, 'noche');
  assert.equal(vista(partida([L, A, A, A, A, A]), 'p3').fase, vista(partida([L, V, B, A, A, A]), 'p3').fase);
});

test('los votos de los lobos solo los ven los lobos', () => {
  let e = ve(partida([L, L, V, A, A, A, A, A]), 'p2', 'p0');
  e = mata(e, 'p0', 'p3');
  assert.deepEqual(vista(e, 'p1').votosLobos, { p0: 'p3' });
  assert.equal('votosLobos' in vista(e, 'p5'), false);
  assert.equal('votosLobos' in vista(e, 'p2'), false);
});

test('el registro público no delata roles ni si la muerte fue por lobos o por veneno', () => {
  const e = noche3(partida([L, V, B, A, A, A, A]), { pocion: { envenenar: 'p4' } });
  const publico = vista(e, 'p5').publico.filter((x) => x.tipo === 'muerte');
  assert.deepEqual(publico.map((m) => m.causa), ['noche', 'noche']);
  for (const m of publico) assert.equal('rol' in m, false);
  assert.equal(JSON.stringify(vista(e, 'p5')).includes('veneno'), false);
  // el estado interno sí conserva la causa real
  assert.deepEqual(eventos(e, 'muerte').map((m) => m.causa), ['lobos', 'veneno']);
});

test('los roles de los muertos se ocultan por defecto y se muestran si la partida lo indica', () => {
  const jugar = (opciones) => mata(ve(partida([L, V, A, A, A], opciones), 'p1', 'p0'), 'p0', 'p2');
  const oculto = jugar({});
  assert.equal('rol' in vista(oculto, 'p4').jugadores.find((j) => j.id === 'p2'), false);
  const visible = jugar({ revelarRoles: true });
  assert.equal(vista(visible, 'p4').jugadores.find((j) => j.id === 'p2').rol, A);
  assert.equal(vista(visible, 'p4').publico.find((x) => x.tipo === 'muerte').rol, A);
});

test('al terminar la partida se revelan todos los roles', () => {
  let e = mata(ve(partida([L, V, A, A, A]), 'p1', 'p0'), 'p0', 'p2');
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
  const otros = e.jugadores.filter((j) => j.vivo && j.id !== id);
  const vivos = e.jugadores.filter((j) => j.vivo);
  const elige = (arr) => arr[Math.floor(rng() * arr.length)].id;
  const voto = (tipo) => ({ tipo, objetivo: rng() < 0.2 ? null : elige(vivos) });
  switch (e.fase) {
    case 'cupido': { const a = elige(vivos); return { tipo: 'enamorar', objetivos: [a, elige(vivos.filter((j) => j.id !== a))] }; }
    case 'vidente': return { tipo: 'ver', objetivo: elige(otros) };
    case 'lobos': return { tipo: 'matar', objetivo: elige(vivos.filter((j) => j.rol !== L)) };
    case 'bruja': {
      const a = { tipo: 'pocion' };
      if (e.bruja.pocionVida && e.noche.victima && rng() < 0.5) a.curar = true;
      if (e.bruja.pocionMuerte && rng() < 0.5) a.envenenar = elige(otros);
      return a;
    }
    case 'cazador': return { tipo: 'disparar', objetivo: elige(vivos) };
    case 'sucesor': return { tipo: 'sucesor', objetivo: elige(vivos) };
    case 'capitan': return voto('elegir');
    default: return voto('votar');
  }
}

test('300 partidas simuladas (con cupido y capitán al azar) terminan con un ganador válido y sin fugas', () => {
  for (let semilla = 1; semilla <= 300; semilla++) {
    const rng = mulberry32(semilla);
    const n = 5 + Math.floor(rng() * 8);
    const roles = rolesPorDefecto(n);
    if (rng() < 0.5) roles[roles.indexOf(A)] = U;
    let e = crearPartida(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nombre: `J${i}` })), {
      roles, rng, capitan: rng() < 0.5, revelarRoles: rng() < 0.5,
    });
    let pasos = 0;
    while (e.fase !== 'fin') {
      assert.ok(++pasos < 3000, `semilla ${semilla}: la partida no termina`);
      const quienes = pendientes(e);
      assert.ok(quienes.length > 0, `semilla ${semilla}: nadie puede actuar en la fase ${e.fase}`);
      e = actuar(e, quienes[0], accionAleatoria(e, quienes[0], rng), rng);
      if (e.fase === 'fin') break;
      const lobos = e.jugadores.filter((j) => j.vivo && j.rol === L).length;
      const resto = e.jugadores.filter((j) => j.vivo).length - lobos;
      assert.ok(lobos > 0 && lobos < resto, `semilla ${semilla}: estado inconsistente`);
      // un jugador cualquiera nunca ve el rol de otro vivo mientras la partida sigue
      const espia = e.jugadores[pasos % n];
      for (const j of vista(e, espia.id).jugadores) {
        if (j.id !== espia.id && j.vivo) assert.equal('rol' in j, false, `semilla ${semilla}: fuga de rol`);
      }
    }
    assert.ok(['pueblo', 'lobos'].includes(e.ganador));
  }
});
