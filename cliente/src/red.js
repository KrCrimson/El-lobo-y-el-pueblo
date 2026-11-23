import { io } from 'socket.io-client';

// En desarrollo el servidor corre en el mismo equipo (puerto 3001). En producción se define VITE_SERVIDOR_URL al compilar.
const URL = import.meta.env.VITE_SERVIDOR_URL || `${location.protocol}//${location.hostname}:3001`;
export const socket = io(URL, { transports: ['websocket', 'polling'] });

// localStorage puede fallar (modo privado): se cae a memoria sin romper nada.
const memoria = {};
export const guardado = {
  leer: (k) => { try { return localStorage.getItem(k) ?? memoria[k] ?? null; } catch { return memoria[k] ?? null; } },
  poner: (k, v) => { memoria[k] = v; try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  borrar: (k) => { delete memoria[k]; try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

/** Identificador secreto de este navegador: sirve para volver a la misma sala tras recargar. */
export function token() {
  let t = guardado.leer('lobos.token');
  if (!t) {
    const b = crypto.getRandomValues(new Uint8Array(24)); // getRandomValues existe también en http (randomUUID no)
    t = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    guardado.poner('lobos.token', t);
  }
  return t;
}

export const pedir = (evento, datos) => new Promise((res) => {
  socket.timeout(8000).emit(evento, datos, (err, r) => res(err ? { ok: false, error: 'El servidor no responde. ¿Sigue encendido?' } : r));
});
