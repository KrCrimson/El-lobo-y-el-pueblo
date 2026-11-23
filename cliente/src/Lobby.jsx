import { useState } from 'react';
import { pedir } from './red.js';

export default function Lobby({ vista, salir }) {
  const { jugadoresSala: jugadores, yo, minimo, maximo, codigo } = vista;
  const soyAnfitrion = vista.anfitrionId === yo;
  const presentes = jugadores.filter((j) => j.conectado).length;

  const sugeridos = {
    lobos: Math.max(1, Math.floor(presentes / 4)), vidente: true, bruja: presentes >= 6, cazador: presentes >= 8,
    cupido: false, capitan: false, revelarRoles: false,
  };
  const [cfg, setCfg] = useState(null);
  const c = cfg ?? sugeridos;
  const maxLobos = Math.max(1, Math.ceil(presentes / 2) - 1);
  const lobos = Math.min(c.lobos, maxLobos);
  const especiales = ['vidente', 'bruja', 'cazador', 'cupido'].filter((k) => c[k]).length;
  const aldeanos = presentes - lobos - especiales;
  // Antes de llegar al mínimo de jugadores no tiene sentido avisar de roles de sobra
  const cabe = aldeanos >= 0 || presentes < minimo;

  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const enlace = `${location.origin}${location.pathname}?sala=${codigo}`;

  const copiar = async () => {
    try { await navigator.clipboard.writeText(enlace); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { window.prompt('Copia este enlace:', enlace); }
  };
  const empezar = async () => {
    setError('');
    const r = await pedir('empezar', { config: { ...c, lobos } });
    if (!r.ok) setError(r.error);
  };

  return (
    <section className="lobby">
      <header>
        <p className="etiqueta">Sala</p>
        <h2 className="codigo-grande" aria-label={`Código de sala ${codigo.split('').join(' ')}`}>{codigo}</h2>
        <button className="secundario" onClick={copiar}>{copiado ? '¡Enlace copiado!' : 'Copiar enlace para invitar'}</button>
      </header>

      <div className="tarjeta">
        <h3>Jugadores ({jugadores.length}/{maximo})</h3>
        <ul className="lista">
          {jugadores.map((j) => (
            <li key={j.id}>
              <span className={`punto ${j.conectado ? 'on' : 'off'}`} title={j.conectado ? 'Conectado' : 'Desconectado'} />
              {j.nombre}{j.id === yo && ' (tú)'}{j.anfitrion && <span className="corona" title="Anfitrión"> 👑</span>}
            </li>
          ))}
        </ul>
      </div>

      {soyAnfitrion ? (
        <div className="tarjeta">
          <h3>Roles de la partida</h3>
          <div className="fila">
            <span>🐺 Lobos</span>
            <div className="contador">
              <button aria-label="Menos lobos" disabled={lobos <= 1} onClick={() => setCfg({ ...c, lobos: lobos - 1 })}>−</button>
              <strong>{lobos}</strong>
              <button aria-label="Más lobos" disabled={lobos >= maxLobos} onClick={() => setCfg({ ...c, lobos: lobos + 1 })}>+</button>
            </div>
          </div>
          {[['vidente', '🔮 Vidente'], ['bruja', '🧪 Bruja'], ['cazador', '🏹 Cazador'], ['cupido', '💘 Cupido']].map(([k, rotulo]) => (
            <label key={k} className="fila interruptor">
              <span>{rotulo}</span>
              <input type="checkbox" checked={!!c[k]} onChange={(e) => setCfg({ ...c, [k]: e.target.checked })} />
            </label>
          ))}
          <p className="etiqueta">Opciones</p>
          {[['capitan', '🎖️ Elegir un capitán (voto doble)'], ['revelarRoles', '💀 Mostrar el rol de quien muere']].map(([k, rotulo]) => (
            <label key={k} className="fila interruptor">
              <span>{rotulo}</span>
              <input type="checkbox" checked={!!c[k]} onChange={(e) => setCfg({ ...c, [k]: e.target.checked })} />
            </label>
          ))}
          <p className={cabe ? 'ayuda' : 'error'}>{cabe ? (aldeanos >= 0 ? `🌾 ${aldeanos} aldeanos` : 'Los roles se ajustarán al número de jugadores') : 'Hay más roles que jugadores'}</p>
          <button className="primario" disabled={presentes < minimo || !cabe} onClick={empezar}>
            {presentes < minimo ? `Faltan ${minimo - presentes} jugadores` : 'Empezar partida'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      ) : (
        <p className="ayuda centro">Esperando a que el anfitrión empiece la partida…</p>
      )}
      <button className="enlace" onClick={salir}>Salir de la sala</button>
    </section>
  );
}
