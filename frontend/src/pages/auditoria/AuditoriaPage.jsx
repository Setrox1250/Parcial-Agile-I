import { useCallback, useEffect, useState } from 'react'
import { exportarAuditoria, listarAuditoria } from '../../services/auditoria'
import TablaDatos from '../../components/ui/TablaDatos.jsx'

const INICIAL = { desde: '', hasta: '', actor: '', sucursalId: '', accion: '', resultado: '' }

export default function AuditoriaPage() {
  const [eventos, setEventos] = useState([])
  const [filtros, setFiltros] = useState(INICIAL)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async (aplicados = INICIAL) => {
    setCargando(true)
    const respuesta = await listarAuditoria(aplicados)
    if (respuesta.ok) setEventos(respuesta.data.eventos)
    else setError(respuesta.error.message)
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  function actualizarFiltro(campo, valor) {
    setFiltros((actual) => ({ ...actual, [campo]: valor }))
  }

  function filtrar(evento) {
    evento.preventDefault()
    setError(null)
    cargar(filtros)
  }

  async function descargar() {
    try {
      const blob = await exportarAuditoria(filtros)
      const enlace = document.createElement('a')
      enlace.href = URL.createObjectURL(blob)
      enlace.download = 'auditoria.csv'
      enlace.click()
      URL.revokeObjectURL(enlace.href)
    } catch (causa) {
      setError(causa.message)
    }
  }

  return (
    <section className="modulo-operativo">
      <header className="modulo-cabecera">
        <div>
          <p className="modulo-eyebrow">GOBIERNO Y CONTROL</p>
          <h1>Auditoría operativa</h1>
          <p>Consulta la bitácora inmutable de operaciones, actores, sede y correlación técnica.</p>
        </div>
        <span className="modulo-contador">{eventos.length} eventos</span>
      </header>
      {error && <div className="aviso aviso-error">{error}</div>}

      <div className="tarjeta filtros-operativos">
        <div><p className="tarjeta-eyebrow">EXPLORAR BITÁCORA</p><h2>Filtrar eventos</h2></div>
        <form className="formulario" onSubmit={filtrar}>
          <label>Desde<input type="date" value={filtros.desde} onChange={(e) => actualizarFiltro('desde', e.target.value)} /></label>
          <label>Hasta<input type="date" value={filtros.hasta} onChange={(e) => actualizarFiltro('hasta', e.target.value)} /></label>
          <label>Actor (UUID)<input value={filtros.actor} onChange={(e) => actualizarFiltro('actor', e.target.value)} /></label>
          <label>Sede (UUID)<input value={filtros.sucursalId} onChange={(e) => actualizarFiltro('sucursalId', e.target.value)} /></label>
          <label>Acción<select value={filtros.accion} onChange={(e) => actualizarFiltro('accion', e.target.value)}><option value="">Todas</option><option>CREAR</option><option>ACTUALIZAR</option><option>REVERSAR</option><option>SISTEMA</option></select></label>
          <label>Resultado<select value={filtros.resultado} onChange={(e) => actualizarFiltro('resultado', e.target.value)}><option value="">Todos</option><option>EXITOSO</option><option>RECHAZADO</option><option>ERROR</option></select></label>
          <button className="btn" type="submit">Aplicar filtros</button>
          <button className="btn btn-secundario" type="button" onClick={descargar}>Exportar CSV</button>
        </form>
      </div>

      <div className="tarjeta cola-operativa">
        <div className="cola-operativa-cabecera"><div><p className="tarjeta-eyebrow">RESULTADOS</p><h2>Eventos registrados</h2></div><span>Detalle técnico disponible por evento</span></div>
        {cargando ? <p>Cargando…</p> : (
          <TablaDatos
            filas={eventos}
            columnas={['Fecha', 'Acción', 'Resultado', 'Entidad', 'Rol', 'Sucursal', 'Correlación', 'Detalle']}
            clave={(evento) => evento.id}
            buscarEn={(evento) => `${evento.accion} ${evento.resultado} ${evento.entidad} ${evento.rol} ${evento.sucursal ?? ''} ${evento.correlacion ?? ''}`}
            filtros={[
              { id: 'entidad', etiqueta: 'Entidad', opciones: [...new Set(eventos.map((evento) => evento.entidad).filter(Boolean))].map((valor) => ({ valor, etiqueta: valor })), coincide: (evento, valor) => evento.entidad === valor },
            ]}
            renderFila={(evento) => (
              <tr key={evento.id}>
                <td>{new Date(evento.fecha).toLocaleString('es-PE')}</td><td>{evento.accion}</td><td>{evento.resultado}</td><td>{evento.entidad}</td><td>{evento.rol}</td><td>{evento.sucursal ?? 'Sistema'}</td><td>{evento.correlacion ?? '—'}</td>
                <td><details><summary>Ver detalle</summary><code>{JSON.stringify(evento.metadatos ?? {})}</code></details></td>
              </tr>
            )}
          />
        )}
      </div>
    </section>
  )
}
