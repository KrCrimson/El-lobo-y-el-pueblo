import { useEffect, useState } from 'react';
import { socket, pedir, token, guardado } from './red.js';
import Inicio from './Inicio.jsx';
import Lobby from './Lobby.jsx';
import Partida from './Partida.jsx';

export default function App() {
  const [vista, setVista] = useState(null);
  const [conectado, setConectado] = useState(socket.connected);
  const [intentando, setIntentando] = useState(true);

  useEffect(() => {
    const alSala = (v) => { guardado.poner('lobos.sala', v.codigo); setVista(v); };
    const alConectar = async () => {
      setConectado(true);
      const codigo = guardado.leer('lobos.sala');
      if (codigo) {
        const r = await pedir('reconectar', { codigo, token: token() });
        if (!r.ok) { guardado.borrar('lobos.sala'); setVista(null); }
      }
      setIntentando(false);
    };
    const alDesconectar = () => setConectado(false);
    socket.on('sala', alSala);
    socket.on('connect', alConectar);
    socket.on('disconnect', alDesconectar);
    if (socket.connected) alConectar();
    return () => { socket.off('sala', alSala); socket.off('connect', alConectar); socket.off('disconnect', alDesconectar); };
  }, []);

  const salir = async () => {
    await pedir('salir');
    guardado.borrar('lobos.sala');
    setVista(null);
  };

  return (
    <main className="app">
      {!conectado && (
        <div className="aviso" role="status">
          {intentando ? 'Conectando con el servidor… si estaba dormido puede tardar hasta un minuto.' : 'Sin conexión. Reintentando…'}
        </div>
      )}
      {!vista && <Inicio conectado={conectado} />}
      {vista?.etapa === 'lobby' && <Lobby vista={vista} salir={salir} />}
      {vista && vista.etapa !== 'lobby' && <Partida vista={vista} salir={salir} />}
    </main>
  );
}
