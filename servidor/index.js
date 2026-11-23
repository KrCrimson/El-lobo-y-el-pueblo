'use strict';
/**
 * Servidor de tiempo real (Socket.IO). Solo conecta la red con `salas.js`:
 * valida el tipo de lo que llega, limita el ritmo por socket y envía a cada jugador SU vista.
 *
 * Variables de entorno:
 *   PORT         puerto (Render lo asigna solo). Por defecto 3001.
 *   CORS_ORIGIN  orígenes permitidos separados por coma (ej. https://mi-juego.vercel.app).
 *                En producción es obligatoria; en desarrollo se acepta cualquier origen.
 */
const http = require('node:http');
const { Server } = require('socket.io');
const { crearGestor } = require('./salas');

const LIMITE_EVENTOS = { ventanaMs: 5000, maximo: 40 };

function origenesPermitidos(env = process.env) {
  const lista = (env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.length) return lista;
  if (env.NODE_ENV === 'production') {
    console.warn('CORS_ORIGIN no está definida: se rechazarán todas las conexiones de navegador.');
    return [];
  }
  return true; // desarrollo: cualquier origen (celular por wifi, localhost, etc.)
}

function crearServidor({ gestorOpciones = {}, cors = origenesPermitidos(), ahora = Date.now } = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/salud') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    }
    res.writeHead(404); res.end();
  });
  const io = new Server(server, { cors: { origin: cors }, maxHttpBufferSize: 10_000, serveClient: false });

  const gestor = crearGestor({
    ...gestorOpciones,
    alCambiar: (sala) => {
      for (const { socketId, vista } of gestor.entregas(sala)) io.to(socketId).emit('sala', vista);
    },
  });

  io.on('connection', (socket) => {
    let eventos = [];
    const permitido = () => {
      const t = ahora();
      eventos = eventos.filter((x) => t - x < LIMITE_EVENTOS.ventanaMs);
      eventos.push(t);
      return eventos.length <= LIMITE_EVENTOS.maximo;
    };

    /** Registra un evento: valida el cuerpo, aplica el límite de ritmo y responde {ok} o {ok:false,error}. */
    const evento = (nombre, fn) => socket.on(nombre, (datos, cb) => {
      const ack = typeof cb === 'function' ? cb : () => {};
      if (!permitido()) return ack({ ok: false, error: 'Vas demasiado rápido' });
      if (datos != null && (typeof datos !== 'object' || Array.isArray(datos))) { // null/undefined = evento sin cuerpo
        return ack({ ok: false, error: 'Datos no válidos' });
      }
      try { ack({ ok: true, ...(fn(datos ?? {}) ?? {}) }); } catch (e) { ack({ ok: false, error: e.message }); }
    });

    evento('crear', (d) => gestor.crear({ socketId: socket.id, nombre: d.nombre, token: d.token }));
    evento('unirse', (d) => gestor.unirse({ socketId: socket.id, codigo: d.codigo, nombre: d.nombre, token: d.token }));
    evento('reconectar', (d) => gestor.reconectar({ socketId: socket.id, codigo: d.codigo, token: d.token }));
    evento('empezar', (d) => gestor.empezar(socket.id, d.config));
    evento('actuar', (d) => gestor.jugar(socket.id, d.accion));
    evento('reiniciar', () => gestor.reiniciar(socket.id));
    evento('salir', () => gestor.salir(socket.id));
    socket.on('disconnect', () => gestor.desconectar(socket.id));
  });

  const limpieza = setInterval(() => gestor.limpiar(), 60_000);
  limpieza.unref();
  server.on('close', () => clearInterval(limpieza));
  return { server, io, gestor };
}

module.exports = { crearServidor, origenesPermitidos };

if (require.main === module) {
  const puerto = Number(process.env.PORT) || 3001;
  crearServidor().server.listen(puerto, '0.0.0.0', () => console.log(`Servidor listo en el puerto ${puerto}`));
}
