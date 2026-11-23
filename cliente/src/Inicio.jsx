import { useState } from 'react';
import { pedir, token, guardado } from './red.js';

export default function Inicio({ conectado }) {
  const [nombre, setNombre] = useState(guardado.leer('lobos.nombre') ?? '');
  const [codigo, setCodigo] = useState((new URLSearchParams(location.search).get('sala') ?? '').toUpperCase().slice(0, 4));
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const ir = async (evento, datos) => {
    setError(''); setOcupado(true);
    guardado.poner('lobos.nombre', nombre.trim());
    const r = await pedir(evento, { ...datos, nombre, token: token() });
    setOcupado(false);
    if (!r.ok) setError(r.error);
  };

  return (
    <section className="inicio">
      <div className="luna" aria-hidden="true" />
      <h1>El Lobo<br />y el Pueblo</h1>
      <p className="lema">Cuando cae la noche, alguien en el pueblo no es quien dice ser.</p>

      <div className="tarjeta">
        <label htmlFor="nombre">Tu nombre</label>
        <input id="nombre" value={nombre} maxLength={20} autoComplete="nickname" placeholder="¿Cómo te llamas?"
               onChange={(e) => setNombre(e.target.value)} />

        <button className="primario" disabled={!conectado || ocupado || !nombre.trim()} onClick={() => ir('crear', {})}>
          Crear sala
        </button>

        <div className="separador"><span>o únete a una</span></div>

        <label htmlFor="codigo">Código de sala</label>
        <input id="codigo" className="codigo" value={codigo} maxLength={4} placeholder="ABCD" autoCapitalize="characters"
               onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
        <button disabled={!conectado || ocupado || !nombre.trim() || codigo.length !== 4} onClick={() => ir('unirse', { codigo })}>
          Unirme
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <p className="pie">De 5 a 12 jugadores · cada quien juega desde su propio celular o PC</p>
    </section>
  );
}
