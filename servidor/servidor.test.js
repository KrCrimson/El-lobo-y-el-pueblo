'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: conectarCliente } = require('socket.io-client');
const { crearServidor, origenesPermitidos } = require('./index');
const { TIEMPOS } = require('./salas');

const tok = (n) => `token-integracion-${String(n).padStart(4, '0')}`;
const RAPIDO = { ...TIEMPOS, lobos: 3000, vidente: 3000, bruja: 3000, cazador: 3000, votacion: 3000, nocheMin: 0 };

async function arrancar(opciones = {}) {
  const { server, io, gestor } = crearServidor({ gestorOpciones: { tiempos: RAPIDO }, cors: true, ...opciones });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clientes = [];
  const cliente = async () => {
    const s = conectarCliente(url, { transports: ['websocket'], forceNew: true });
    s.vistas = [];
    s.on('sala', (v) => s.vistas.push(v));
    await new Promise((r) => s.on('connect', r));
    clientes.push(s);
    return s;
  };
  const cerrar = async () => { clientes.forEach((c) => c.close()); await new Promise((r) => io.close(r)); };
  return { url, cliente, cerrar, gestor, server };
}

const pedir = (s, ev, datos) => new Promise((res) => s.timeout(3000).emit(ev, datos, (err, r) => res(err ? { ok: false, error: 'sin respuesta' } : r)));
const esperar = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('tiempo de espera agotado'); await new Promise((r) => setTimeout(r, 10)); } };
const ultima = (s) => s.vistas.at(-1);

/** Jugador automático: cuando es su turno, juega una acción legal según SU vista. */
function bot(s) {
  let clave = '';
  s.on('sala', (v) => {
    const j = v.juego;
    if (!j || !j.puedeActuar) return;
    const k = `${j.fase}-${j.ronda}-${j.jugadores.filter((x) => x.vivo).length}`;
    if (k === clave) return; clave = k;
    const otros = j.jugadores.filter((x) => x.vivo && x.id !== j.yo.id);
    const acciones = {
      lobos: () => ({ tipo: 'matar', objetivo: otros.find((x) => !j.companerosLobo.includes(x.id)).id }),
      vidente: () => ({ tipo: 'ver', objetivo: otros[0].id }),
      bruja: () => ({ tipo: 'pocion' }),
      cazador: () => ({ tipo: 'disparar', objetivo: otros[0].id }),
      votacion: () => ({ tipo: 'votar', objetivo: null }),
    };
    s.emit('actuar', { accion: acciones[j.fase]() }, () => {});
  });
}

test('partida completa por WebSocket: crear, unirse, jugar y terminar sin filtrar roles ni tokens', { timeout: 30000 }, async () => {
  const srv = await arrancar();
  try {
    const cs = []; for (let i = 0; i < 5; i++) cs.push(await srv.cliente());
    const { codigo } = await pedir(cs[0], 'crear', { nombre: 'Ana', token: tok(0) });
    assert.match(codigo, /^[A-Z]{4}$/);
    for (let i = 1; i < 5; i++) assert.equal((await pedir(cs[i], 'unirse', { codigo, nombre: `J${i}`, token: tok(i) })).ok, true);
    await esperar(() => ultima(cs[0]).jugadoresSala.length === 5);
    cs.forEach(bot);
    assert.equal((await pedir(cs[1], 'empezar', {})).ok, false); // no es el anfitrión
    assert.equal((await pedir(cs[0], 'empezar', {})).ok, true);

    await esperar(() => cs.every((c) => ultima(c).juego?.ganador));
    const fin = ultima(cs[0]);
    assert.equal(fin.etapa, 'fin');
    assert.ok(['pueblo', 'lobos'].includes(fin.juego.ganador));

    // Lo que llegó por la red a cada jugador durante la partida
    for (const [i, c] of cs.entries()) {
      for (const v of c.vistas) {
        assert.equal(JSON.stringify(v).includes('token-integracion'), false, 'un token viajó por la red');
        if (!v.juego || v.juego.ganador) continue;
        for (const j of v.juego.jugadores) {
          if (j.id !== v.yo && j.vivo) assert.equal('rol' in j, false, `el jugador ${i} vio el rol de un vivo`);
        }
      }
    }
    // Al terminar el anfitrión puede volver al lobby
    assert.equal((await pedir(cs[0], 'reiniciar')).ok, true);
    await esperar(() => ultima(cs[2]).etapa === 'lobby');
  } finally { await srv.cerrar(); }
});

test('reconexión por WebSocket: otro socket con el mismo token recupera la partida', { timeout: 15000 }, async () => {
  const srv = await arrancar();
  try {
    const cs = []; for (let i = 0; i < 5; i++) cs.push(await srv.cliente());
    const { codigo } = await pedir(cs[0], 'crear', { nombre: 'Ana', token: tok(0) });
    for (let i = 1; i < 5; i++) await pedir(cs[i], 'unirse', { codigo, nombre: `J${i}`, token: tok(i) });
    await pedir(cs[0], 'empezar', {});
    await esperar(() => ultima(cs[3]).juego);
    const rol = ultima(cs[3]).juego.yo.rol;
    cs[3].close();
    await esperar(() => ultima(cs[0]).juego.jugadores.some((j) => !j.conectado));
    const nuevo = await srv.cliente();
    assert.equal((await pedir(nuevo, 'reconectar', { codigo, token: tok(3) })).ok, true);
    await esperar(() => ultima(nuevo)?.juego);
    assert.equal(ultima(nuevo).juego.yo.rol, rol);
    assert.equal((await pedir(await srv.cliente(), 'reconectar', { codigo, token: tok(99) })).ok, false);
  } finally { await srv.cerrar(); }
});

test('datos mal formados y exceso de eventos se rechazan sin tumbar el servidor', { timeout: 15000 }, async () => {
  const srv = await arrancar();
  try {
    const c = await srv.cliente();
    for (const malo of ['texto', 42, null, [1, 2]]) {
      const r = await pedir(c, 'crear', malo === null ? null : malo);
      assert.equal(r.ok, false);
    }
    assert.equal((await pedir(c, 'actuar', { accion: 'x' })).ok, false); // sin sala
    const respuestas = await Promise.all(Array.from({ length: 80 }, () => pedir(c, 'crear', { nombre: '', token: 'corto' })));
    assert.ok(respuestas.some((r) => r.error === 'Vas demasiado rápido'), 'no se aplicó el límite de ritmo');
    assert.equal(srv.server.listening, true);
  } finally { await srv.cerrar(); }
});

test('origenesPermitidos: en producción exige CORS_ORIGIN; en desarrollo acepta todo', () => {
  assert.equal(origenesPermitidos({}), true);
  assert.deepEqual(origenesPermitidos({ NODE_ENV: 'production', CORS_ORIGIN: ' https://a.app , https://b.app ' }), ['https://a.app', 'https://b.app']);
  const aviso = console.warn; console.warn = () => {};
  try { assert.deepEqual(origenesPermitidos({ NODE_ENV: 'production' }), []); } finally { console.warn = aviso; }
});
