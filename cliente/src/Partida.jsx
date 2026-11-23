import { useEffect, useRef, useState } from 'react';
import { pedir } from './red.js';

const ROLES = {
  aldeano: { icono: '🌾', nombre: 'Aldeano', texto: 'No tienes poderes. Usa tu ojo y tu voz para descubrir a los lobos.' },
  lobo: { icono: '🐺', nombre: 'Lobo', texto: 'Cada noche eligen a una víctima. De día, finge ser inocente.' },
  vidente: { icono: '🔮', nombre: 'Vidente', texto: 'Cada noche, antes que los lobos, descubres el verdadero rol de un jugador.' },
  bruja: { icono: '🧪', nombre: 'Bruja', texto: 'Tienes una poción de vida y una de muerte. Cada una se usa una sola vez.' },
  cazador: { icono: '🏹', nombre: 'Cazador', texto: 'Si mueres, te llevas a alguien contigo.' },
  cupido: { icono: '💘', nombre: 'Cupido', texto: 'La primera noche enamoras a dos jugadores: si uno muere, el otro también.' },
};

const FASES_NOCHE = ['noche', 'cupido', 'vidente', 'lobos', 'bruja'];

const CAUSAS = {
  noche: 'ha muerto durante la noche',
  votacion: 'ha sido linchado por el pueblo',
  cazador: 'ha caído por el disparo del cazador',
  amor: 'ha muerto de amor',
};

/** Texto de un suceso público. El servidor ya quitó lo que no debe saberse (roles, veneno, lobos). */
function textoEvento(e, nombreDe) {
  switch (e.tipo) {
    case 'muerte': return `💀 ${e.nombre} ${CAUSAS[e.causa] ?? 'ha muerto'}${e.rol ? ` (era ${ROLES[e.rol].nombre.toLowerCase()})` : ''}.`;
    case 'sin_muertes': return '🌅 Amaneció y nadie murió.';
    case 'sin_linchamiento': return '🗳️ El pueblo no se puso de acuerdo: nadie es linchado.';
    case 'capitan': return e.sucesion ? `🎖️ ${e.nombre} es el nuevo capitán.` : `🎖️ El pueblo ha elegido a ${e.nombre} como capitán.`;
    case 'sin_capitan': return '🎖️ Nadie fue elegido capitán.';
    case 'recuento': {
      const partes = Object.entries(e.votos).map(([id, n]) => `${nombreDe(id)} ${n}`);
      return partes.length ? `🗳️ Recuento: ${partes.join(', ')}.` : '🗳️ Nadie recibió votos.';
    }
    case 'fin': return e.ganador === 'pueblo' ? '🏆 ¡El pueblo ha ganado!' : '🏆 ¡Los lobos han ganado!';
    default: return '';
  }
}

/** Lo que dice el "narrador" en cada momento. Igual para todos salvo cuando te toca actuar. */
function narrador(j) {
  switch (j.fase) {
    case 'noche': return '🌙 La noche cae sobre el pueblo. Cierra los ojos y espera el amanecer…';
    case 'cupido': return '💘 Cupido despierta y apunta con su flecha…';
    case 'vidente': return '🔮 La vidente abre los ojos y mira a un jugador…';
    case 'lobos': return '🐺 Los lobos despiertan y buscan una víctima…';
    case 'bruja': return '🧪 La bruja despierta con sus pociones…';
    case 'capitan': return '🎖️ Amanece. El pueblo debe elegir a su capitán: su voto valdrá doble.';
    case 'votacion': return '☀️ Es de día. Debatan y voten a quién linchar.';
    case 'cazador': return '🏹 Un disparo final está a punto de sonar…';
    case 'sucesor': return '🎖️ El capitán moribundo nombra a su sucesor…';
    case 'fin': return '🏁 La partida ha terminado.';
    default: return '';
  }
}

/** Notas privadas del jugador: solo él las ve. Nunca se mezclan con el registro público. */
function notasPrivadas(j, nombreDe) {
  const notas = [];
  if (j.yo.rol === 'lobo' && j.companerosLobo?.length) notas.push(`🐺 Tus compañeros lobo: ${j.companerosLobo.map(nombreDe).join(', ')}.`);
  if (j.yo.rol === 'vidente' && j.vistos?.length) notas.push(`🔮 Has visto: ${j.vistos.map((v) => `${nombreDe(v.id)} es ${ROLES[v.rol].nombre.toLowerCase()}`).join(' · ')}.`);
  if (j.yo.rol === 'bruja' && j.pociones) {
    notas.push(`🧪 Pociones: vida ${j.pociones.pocionVida ? 'disponible' : 'usada'}, muerte ${j.pociones.pocionMuerte ? 'disponible' : 'usada'}.`);
  }
  if (j.yo.rol === 'cupido' && j.enamorados) notas.push(`💘 Enamoraste a ${j.enamorados.map(nombreDe).join(' y ')}.`);
  if (j.enamoradoCon) notas.push(`💘 Estás enamorado/a de ${nombreDe(j.enamoradoCon)}: si uno muere, el otro también.`);
  if (j.capitan === j.yo.id) notas.push('🎖️ Eres el capitán: tu voto vale doble.');
  return notas;
}

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

/** Aviso grande y pasajero cuando ocurre algo nuevo (amanecer, muertes, capitán…). No repite lo ya ocurrido al reconectar. */
function useAviso(publico, nombreDe) {
  const procesados = useRef(publico.length);
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    if (publico.length <= procesados.current) return undefined;
    const textos = publico.slice(procesados.current).filter((e) => e.tipo !== 'recuento').map((e) => textoEvento(e, nombreDe)).filter(Boolean);
    procesados.current = publico.length;
    if (!textos.length) return undefined;
    setAviso({ id: publico.length, textos });
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publico.length]);
  return aviso;
}

function Elegir({ lista, onElegir, rotulo = '', activos = [] }) {
  return (
    <ul className="eleccion">
      {lista.map((x) => (
        <li key={x.id}>
          <button className={activos.includes(x.id) ? 'activo' : ''} onClick={() => onElegir(x.id)}>{rotulo}{x.nombre}</button>
        </li>
      ))}
    </ul>
  );
}

export default function Partida({ vista, salir }) {
  const j = vista.juego;
  const yo = j.yo;
  const [verRol, setVerRol] = useState(false);
  const [error, setError] = useState('');
  const [curar, setCurar] = useState(false);
  const [veneno, setVeneno] = useState(null);
  const [pareja, setPareja] = useState([]);
  const restante = useCuentaAtras(j.temporizador);

  const nombreDe = (id) => j.jugadores.find((x) => x.id === id)?.nombre ?? '?';
  const vivos = j.jugadores.filter((x) => x.vivo);
  const otrosVivos = vivos.filter((x) => x.id !== yo.id);
  const soyAnfitrion = vista.anfitrionId === yo.id;
  const rol = ROLES[yo.rol];
  const aviso = useAviso(j.publico, nombreDe);
  const ambiente = FASES_NOCHE.includes(j.fase) ? 'noche' : 'dia';
  const notas = notasPrivadas(j, nombreDe);

  // El fondo de toda la página cambia entre noche y día
  useEffect(() => {
    document.body.dataset.ambiente = ambiente;
    return () => { delete document.body.dataset.ambiente; };
  }, [ambiente]);

  const enviar = async (accion) => {
    setError('');
    const r = await pedir('actuar', { accion });
    if (!r.ok) setError(r.error);
    return r.ok;
  };

  // Al cambiar de fase se limpian las elecciones pendientes
  useEffect(() => { setCurar(false); setVeneno(null); setPareja([]); }, [j.fase, j.ronda]);

  let panel;
  if (j.fase === 'fin') {
    panel = (
      <div className={`banner ${j.ganador}`}>
        <h2>{j.ganador === 'pueblo' ? '🏆 Gana el pueblo' : '🐺 Ganan los lobos'}</h2>
        <ul className="revelado">
          {j.jugadores.map((x) => <li key={x.id}>{ROLES[x.rol].icono} {x.nombre} <span>{ROLES[x.rol].nombre}{x.vivo ? '' : ' · murió'}</span></li>)}
        </ul>
        {soyAnfitrion
          ? <button className="primario" onClick={() => pedir('reiniciar').then((r) => !r.ok && setError(r.error))}>Nueva partida</button>
          : <p className="ayuda">Esperando al anfitrión para otra partida…</p>}
      </div>
    );
  } else if (!yo.vivo && !(j.puedeActuar && ['cazador', 'sucesor'].includes(j.fase))) {
    panel = <div className="estado"><h2>👻 Has sido eliminado</h2><p>Mira la partida en silencio: no puedes hablar ni votar.</p></div>;
  } else if (j.fase === 'noche') {
    panel = <div className="estado noche"><h2>🌙 Es de noche</h2><p>Cierra los ojos y no hables. El pueblo duerme…</p></div>;
  } else if (j.fase === 'cupido' && j.puedeActuar) {
    panel = (
      <div className="estado">
        <h2>💘 Elige a los enamorados</h2>
        <p>Selecciona a dos jugadores (puedes elegirte a ti). Si uno muere, el otro también.</p>
        <Elegir lista={vivos} activos={pareja} onElegir={(id) => setPareja((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : [p[1], id]))} />
        <button className="primario" disabled={pareja.length !== 2} onClick={() => enviar({ tipo: 'enamorar', objetivos: pareja })}>Enamorar</button>
      </div>
    );
  } else if (j.fase === 'lobos' && j.puedeActuar) {
    const presas = otrosVivos.filter((x) => !j.companerosLobo.includes(x.id));
    panel = (
      <div className="estado">
        <h2>🐺 Elijan a su víctima</h2>
        <p>Si sus votos no coinciden, el azar decide entre los más votados.</p>
        {Object.keys(j.votosLobos ?? {}).length > 0 && (
          <p className="nota">Votos de la manada: {Object.entries(j.votosLobos).map(([l, o]) => `${nombreDe(l)} → ${nombreDe(o)}`).join(' · ')}</p>
        )}
        <Elegir lista={presas} onElegir={(objetivo) => enviar({ tipo: 'matar', objetivo })} />
      </div>
    );
  } else if (j.fase === 'vidente' && j.puedeActuar) {
    panel = (
      <div className="estado">
        <h2>🔮 ¿A quién quieres ver?</h2>
        <p>Descubrirás su verdadero rol. Esta noche aún no han atacado los lobos.</p>
        <Elegir lista={otrosVivos} onElegir={(objetivo) => enviar({ tipo: 'ver', objetivo })} />
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
            <Elegir lista={otrosVivos} activos={veneno ? [veneno] : []} onElegir={(id) => setVeneno(veneno === id ? null : id)} />
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
        <Elegir lista={vivos} onElegir={(objetivo) => enviar({ tipo: 'disparar', objetivo })} />
      </div>
    ) : <div className="estado"><h2>🏹 El cazador va a disparar…</h2></div>;
  } else if (j.fase === 'sucesor') {
    panel = j.puedeActuar ? (
      <div className="estado">
        <h2>🎖️ Nombra a tu sucesor</h2>
        <p>Tu título pasa a quien elijas.</p>
        <Elegir lista={vivos} onElegir={(objetivo) => enviar({ tipo: 'sucesor', objetivo })} />
      </div>
    ) : <div className="estado"><h2>🎖️ El capitán nombra a su sucesor…</h2></div>;
  } else if (j.fase === 'capitan') {
    const yaVote = j.yaVotaron?.includes(yo.id);
    panel = (
      <div className="estado">
        <h2>🎖️ Elijan a su capitán</h2>
        <p>{yaVote ? 'Voto registrado. Puedes cambiarlo mientras falten votos.' : 'El capitán desempata y su voto vale doble. Lo elige el pueblo.'}</p>
        <Elegir lista={vivos} onElegir={(objetivo) => enviar({ tipo: 'elegir', objetivo })} />
        <button className="secundario" onClick={() => enviar({ tipo: 'elegir', objetivo: null })}>Abstenerme</button>
        <p className="ayuda">Han votado {j.yaVotaron?.length ?? 0} de {vivos.length}</p>
      </div>
    );
  } else if (j.fase === 'votacion') {
    const yaVote = j.yaVotaron?.includes(yo.id);
    panel = (
      <div className="estado">
        <h2>🗳️ El pueblo vota</h2>
        <p>{yaVote ? 'Voto registrado. Puedes cambiarlo mientras falten votos.' : '¿A quién quieres linchar?'}</p>
        <Elegir lista={otrosVivos} onElegir={(objetivo) => enviar({ tipo: 'votar', objetivo })} />
        <button className="secundario" onClick={() => enviar({ tipo: 'votar', objetivo: null })}>Abstenerme</button>
        <p className="ayuda">Han votado {j.yaVotaron?.length ?? 0} de {vivos.length}</p>
      </div>
    );
  } else {
    panel = <div className="estado"><h2>Esperando…</h2></div>;
  }

  const registro = [...j.publico].reverse().map((e, i) => ({ k: i, t: textoEvento(e, nombreDe) })).filter((x) => x.t);
  const progreso = j.temporizador ? Math.max(0, Math.min(1, j.temporizador.restanteMs / j.temporizador.totalMs)) : null;

  return (
    <section className="partida">
      <div className="astro" aria-hidden="true" />
      {aviso && (
        <div className="aviso-evento" key={aviso.id} role="status">
          {aviso.textos.map((t, i) => <p key={i}>{t}</p>)}
        </div>
      )}

      <header className="barra">
        <span>Sala <strong>{vista.codigo}</strong></span>
        <span>{ambiente === 'noche' ? '🌙' : '☀️'} Ronda {j.ronda}</span>
        {restante !== null && <span className={`reloj ${restante <= 10 ? 'urgente' : ''}`} aria-label="Tiempo restante">⏳ {restante}s</span>}
        {progreso !== null && <div className="progreso" aria-hidden="true"><span style={{ width: `${progreso * 100}%` }} /></div>}
      </header>
      <p className="narrador" key={j.fase}>{narrador(j)}</p>

      <div className="columnas">
        <div className="principal">
          <button className={`rol ${verRol ? 'abierto' : ''}`} onClick={() => setVerRol(!verRol)} aria-pressed={verRol}>
            {verRol ? (
              <>
                <span className="rol-icono">{rol.icono}</span>
                <span><strong>{rol.nombre}</strong><br />{rol.texto}</span>
              </>
            ) : <span>👁️ Toca para ver tu rol y tus notas (que nadie mire tu pantalla)</span>}
          </button>
          {verRol && notas.map((n, i) => <p className="nota" key={i}>{n}</p>)}

          <div className="panel" key={j.fase}>{panel}</div>
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
                  {j.capitan === x.id && <span title="Capitán"> 🎖️</span>}
                  {!x.vivo && x.rol && <span className="rol-muerto"> {ROLES[x.rol].icono}</span>}
                  {(j.fase === 'votacion' || j.fase === 'capitan') && j.yaVotaron?.includes(x.id) && <span title="Ya votó"> ✔️</span>}
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
