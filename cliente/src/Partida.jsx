import { useEffect, useState } from 'react';
import { pedir } from './red.js';

const ROLES = {
  aldeano: { icono: '🌾', nombre: 'Aldeano', texto: 'No tienes poderes. Usa tu ojo y tu voz para descubrir a los lobos.' },
  lobo: { icono: '🐺', nombre: 'Lobo', texto: 'Cada noche eligen a una víctima. De día, finge ser inocente.' },
  vidente: { icono: '🔮', nombre: 'Vidente', texto: 'Cada noche descubres el verdadero rol de un jugador.' },
  bruja: { icono: '🧪', nombre: 'Bruja', texto: 'Tienes una poción de vida y una de muerte. Cada una se usa una sola vez.' },
  cazador: { icono: '🏹', nombre: 'Cazador', texto: 'Si mueres, te llevas a alguien contigo.' },
};
const CAUSAS = { lobos: 'devorado por los lobos', veneno: 'envenenado', votacion: 'linchado por el pueblo', cazador: 'abatido por el cazador' };

function useCuentaAtras(temporizador) {
  const [restante, setRestante] = useState(null);
  useEffect(() => {
    if (!temporizador) { setRestante(null); return undefined; }
    const fin = Date.now() + temporizador.restanteMs;
    const tick = () => setRestante(Math.max(0, Math.ceil((fin - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [temporizador]);
  return restante;
}

function textoEvento(e, nombreDe) {
  switch (e.tipo) {
    case 'muerte': return `💀 ${e.nombre} ha muerto, ${CAUSAS[e.causa]}. Era ${ROLES[e.rol].nombre.toLowerCase()}.`;
    case 'sin_muertes': return '🌅 Amaneció y nadie murió.';
    case 'sin_linchamiento': return '🗳️ El pueblo no se puso de acuerdo: nadie es linchado.';
    case 'recuento': {
      const partes = Object.entries(e.votos).map(([id, n]) => `${nombreDe(id)} ${n}`);
      return partes.length ? `🗳️ Recuento: ${partes.join(', ')}.` : '🗳️ Nadie recibió votos.';
    }
    case 'fin': return e.ganador === 'pueblo' ? '🏆 ¡El pueblo ha ganado!' : '🏆 ¡Los lobos han ganado!';
    default: return '';
  }
}

export default function Partida({ vista, salir }) {
  const j = vista.juego;
  const yo = j.yo;
  const [verRol, setVerRol] = useState(false);
  const [error, setError] = useState('');
  const [curar, setCurar] = useState(false);
  const [veneno, setVeneno] = useState(null);
  const restante = useCuentaAtras(j.temporizador);

  const nombreDe = (id) => j.jugadores.find((x) => x.id === id)?.nombre ?? '?';
  const vivos = j.jugadores.filter((x) => x.vivo);
  const otrosVivos = vivos.filter((x) => x.id !== yo.id);
  const soyAnfitrion = vista.anfitrionId === yo.id;
  const rol = ROLES[yo.rol];

  const enviar = async (accion) => {
    setError('');
    const r = await pedir('actuar', { accion });
    if (!r.ok) setError(r.error);
    return r.ok;
  };

  // Al cambiar de fase se limpian las elecciones de la bruja
  useEffect(() => { setCurar(false); setVeneno(null); }, [j.fase, j.ronda]);

  const Elegir = ({ lista, accion, rotulo }) => (
    <ul className="eleccion">
      {lista.map((x) => (
        <li key={x.id}><button onClick={() => enviar(accion(x.id))}>{rotulo?.(x) ?? ''}{x.nombre}</button></li>
      ))}
    </ul>
  );

  let panel;
  if (j.fase === 'fin') {
    panel = (
      <div className={`banner ${j.ganador}`}>
        <h2>{j.ganador === 'pueblo' ? '🏆 Gana el pueblo' : '🐺 Ganan los lobos'}</h2>
        <ul className="revelado">
          {j.jugadores.map((x) => <li key={x.id}>{ROLES[x.rol].icono} {x.nombre} <span>{ROLES[x.rol].nombre}</span></li>)}
        </ul>
        {soyAnfitrion
          ? <button className="primario" onClick={() => pedir('reiniciar').then((r) => !r.ok && setError(r.error))}>Nueva partida</button>
          : <p className="ayuda">Esperando al anfitrión para otra partida…</p>}
      </div>
    );
  } else if (!yo.vivo && !(j.fase === 'cazador' && j.puedeActuar)) {
    panel = <div className="estado"><h2>👻 Has sido eliminado</h2><p>Mira la partida en silencio: no puedes hablar ni votar.</p></div>;
  } else if (j.fase === 'noche') {
    panel = <div className="estado noche"><h2>🌙 Es de noche</h2><p>Cierra los ojos y no hables. El pueblo duerme…</p></div>;
  } else if (j.fase === 'lobos' && j.puedeActuar) {
    const presas = otrosVivos.filter((x) => !j.companerosLobo.includes(x.id));
    panel = (
      <div className="estado">
        <h2>🐺 Elijan a su víctima</h2>
        <p>Si sus votos no coinciden, el azar decide entre los más votados.</p>
        <Elegir lista={presas} accion={(objetivo) => ({ tipo: 'matar', objetivo })} />
      </div>
    );
  } else if (j.fase === 'vidente' && j.puedeActuar) {
    panel = (
      <div className="estado">
        <h2>🔮 ¿A quién quieres ver?</h2>
        <Elegir lista={otrosVivos} accion={(objetivo) => ({ tipo: 'ver', objetivo })} />
      </div>
    );
  } else if (j.fase === 'bruja' && j.puedeActuar) {
    const p = j.pociones;
    panel = (
      <div className="estado">
        <h2>🧪 Tu turno, bruja</h2>
        <p>Los lobos atacaron a <strong>{nombreDe(j.victimaDeLosLobos)}</strong>.</p>
        {p.pocionVida
          ? <label className="fila interruptor"><span>Salvarle con la poción de vida</span><input type="checkbox" checked={curar} onChange={(e) => setCurar(e.target.checked)} /></label>
          : <p className="ayuda">Ya usaste tu poción de vida.</p>}
        {p.pocionMuerte ? (
          <>
            <p className="etiqueta">Poción de muerte (opcional)</p>
            <ul className="eleccion">
              {otrosVivos.map((x) => (
                <li key={x.id}><button className={veneno === x.id ? 'activo' : ''} onClick={() => setVeneno(veneno === x.id ? null : x.id)}>{x.nombre}</button></li>
              ))}
            </ul>
          </>
        ) : <p className="ayuda">Ya usaste tu poción de muerte.</p>}
        <button className="primario" onClick={() => enviar({ tipo: 'pocion', curar, envenenar: veneno })}>
          {curar || veneno ? 'Confirmar' : 'No hacer nada'}
        </button>
      </div>
    );
  } else if (j.fase === 'cazador') {
    panel = j.puedeActuar ? (
      <div className="estado">
        <h2>🏹 Tu último disparo</h2>
        <p>Te llevas a alguien contigo. Elige bien.</p>
        <Elegir lista={vivos.filter((x) => x.id !== yo.id)} accion={(objetivo) => ({ tipo: 'disparar', objetivo })} />
      </div>
    ) : <div className="estado"><h2>🏹 El cazador va a disparar…</h2></div>;
  } else if (j.fase === 'votacion') {
    const yaVote = j.yaVotaron?.includes(yo.id);
    panel = (
      <div className="estado">
        <h2>🗳️ El pueblo vota</h2>
        <p>{yaVote ? 'Voto registrado. Puedes cambiarlo mientras falten votos.' : '¿A quién quieres linchar?'}</p>
        <Elegir lista={otrosVivos} accion={(objetivo) => ({ tipo: 'votar', objetivo })} />
        <button className="secundario" onClick={() => enviar({ tipo: 'votar', objetivo: null })}>Abstenerme</button>
        <p className="ayuda">Han votado {j.yaVotaron?.length ?? 0} de {vivos.length}</p>
      </div>
    );
  } else {
    panel = <div className="estado"><h2>Esperando…</h2></div>;
  }

  const registro = [...j.publico].reverse().map((e, i) => ({ k: i, t: textoEvento(e, nombreDe) })).filter((x) => x.t);

  return (
    <section className="partida">
      <header className="barra">
        <span>Sala <strong>{vista.codigo}</strong></span>
        <span>Ronda {j.ronda}</span>
        {restante !== null && <span className={`reloj ${restante <= 10 ? 'urgente' : ''}`} aria-label="Tiempo restante">⏳ {restante}s</span>}
      </header>

      <div className="columnas">
        <div className="principal">
          <button className={`rol ${verRol ? 'abierto' : ''}`} onClick={() => setVerRol(!verRol)} aria-pressed={verRol}>
            {verRol ? (
              <>
                <span className="rol-icono">{rol.icono}</span>
                <span><strong>{rol.nombre}</strong><br />{rol.texto}</span>
              </>
            ) : <span>👁️ Toca para ver tu rol (que nadie mire tu pantalla)</span>}
          </button>

          {verRol && yo.rol === 'lobo' && j.companerosLobo.length > 0 && (
            <p className="nota">Tus compañeros lobo: {j.companerosLobo.map(nombreDe).join(', ')}</p>
          )}
          {verRol && yo.rol === 'vidente' && j.vistos.length > 0 && (
            <p className="nota">Has visto: {j.vistos.map((v) => `${nombreDe(v.id)} es ${ROLES[v.rol].nombre.toLowerCase()}`).join(' · ')}</p>
          )}
          {j.fase === 'lobos' && j.puedeActuar && Object.keys(j.votosLobos ?? {}).length > 0 && (
            <p className="nota">Votos de la manada: {Object.entries(j.votosLobos).map(([l, o]) => `${nombreDe(l)} → ${nombreDe(o)}`).join(' · ')}</p>
          )}

          {panel}
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <aside className="lateral">
          <div className="tarjeta">
            <h3>Jugadores</h3>
            <ul className="lista">
              {j.jugadores.map((x) => (
                <li key={x.id} className={x.vivo ? '' : 'muerto'}>
                  <span className={`punto ${x.conectado ? 'on' : 'off'}`} />
                  {x.nombre}{x.id === yo.id && ' (tú)'}
                  {!x.vivo && x.rol && <span className="rol-muerto"> {ROLES[x.rol].icono}</span>}
                  {j.fase === 'votacion' && j.yaVotaron?.includes(x.id) && <span title="Ya votó"> ✔️</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="tarjeta registro" aria-live="polite">
            <h3>Lo que ha pasado</h3>
            {registro.length === 0 ? <p className="ayuda">Aún no ha pasado nada.</p> : <ul>{registro.map((r) => <li key={r.k}>{r.t}</li>)}</ul>}
          </div>
          <button className="enlace" onClick={salir}>Salir de la partida</button>
        </aside>
      </div>
    </section>
  );
}
