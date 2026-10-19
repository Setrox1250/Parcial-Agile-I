import { useEffect, useState } from 'react'
import { listarAuditoria } from '../../services/auditoria'
export default function AuditoriaPage() {
  const [eventos, setEventos] = useState([]); const [error, setError] = useState(null); const [cargando, setCargando] = useState(true)
  useEffect(() => { listarAuditoria().then((r) => { if (r.ok) setEventos(r.data.eventos); else setError(r.error.message); setCargando(false) }) }, [])
  return <section><h1>Auditoría operativa</h1><p>Bitácora inmutable de operaciones, actores, sede y correlación técnica.</p>{error && <div className="aviso aviso-error">{error}</div>}<div className="tarjeta">{cargando ? <p>Cargando…</p> : <table className="tabla"><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Rol</th><th>Sucursal</th><th>Correlación</th></tr></thead><tbody>{eventos.map((e) => <tr key={e.id}><td>{new Date(e.fecha).toLocaleString('es-PE')}</td><td>{e.accion}</td><td>{e.entidad}</td><td>{e.rol}</td><td>{e.sucursal ?? 'Sistema'}</td><td>{e.correlacion ?? '—'}</td></tr>)}</tbody></table>}</div></section>
}
