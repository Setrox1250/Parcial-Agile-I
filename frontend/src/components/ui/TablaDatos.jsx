import { Fragment, useMemo, useState } from 'react'

const normalizar = (valor) => String(valor ?? '').toLocaleLowerCase('es-PE')

// Tabla de lectura reutilizable: centraliza búsqueda local, filtros por categoría y paginación.
// Las celdas se mantienen en cada módulo mediante renderFila para no acoplar las reglas de negocio.
export default function TablaDatos({
  filas,
  columnas,
  renderFila,
  clave,
  buscarEn,
  filtros = [],
  filasPorPagina = 10,
  className = 'tabla',
  textoVacio = 'No hay registros que coincidan con los filtros.',
}) {
  const [busqueda, setBusqueda] = useState('')
  const [valoresFiltro, setValoresFiltro] = useState({})
  const [pagina, setPagina] = useState(1)

  const resultados = useMemo(() => {
    const termino = normalizar(busqueda).trim()
    return filas.filter((fila) => {
      const coincideBusqueda = !termino || normalizar(buscarEn?.(fila)).includes(termino)
      const coincideFiltros = filtros.every((filtro) => {
        const valor = valoresFiltro[filtro.id] ?? ''
        return !valor || filtro.coincide(fila, valor)
      })
      return coincideBusqueda && coincideFiltros
    })
  }, [buscarEn, busqueda, filas, filtros, valoresFiltro])

  const totalPaginas = Math.max(1, Math.ceil(resultados.length / filasPorPagina))
  const paginaActual = Math.min(pagina, totalPaginas)
  const inicio = (paginaActual - 1) * filasPorPagina
  const filasVisibles = resultados.slice(inicio, inicio + filasPorPagina)

  function cambiarBusqueda(evento) {
    setBusqueda(evento.target.value)
    setPagina(1)
  }

  function cambiarFiltro(id, valor) {
    setValoresFiltro((actual) => ({ ...actual, [id]: valor }))
    setPagina(1)
  }

  return (
    <div className="tabla-datos">
      <div className="tabla-datos-controles">
        <label className="tabla-datos-busqueda">
          Buscar
          <input
            type="search"
            value={busqueda}
            onChange={cambiarBusqueda}
            placeholder="Buscar en la tabla"
            aria-label="Buscar en la tabla"
          />
        </label>
        {filtros.map((filtro) => (
          <label className="tabla-datos-filtro" key={filtro.id}>
            {filtro.etiqueta}
            <select
              value={valoresFiltro[filtro.id] ?? ''}
              onChange={(evento) => cambiarFiltro(filtro.id, evento.target.value)}
            >
              <option value="">{filtro.todas ?? `Todos los ${filtro.etiqueta.toLocaleLowerCase('es-PE')}`}</option>
              {filtro.opciones.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>{opcion.etiqueta}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <p className="tabla-datos-resumen">
        {resultados.length} de {filas.length} registro{filas.length === 1 ? '' : 's'}
      </p>

      <div className="tabla-envoltura">
        <table className={className}>
          <thead>
            <tr>
              {columnas.map((columna, indice) => <th key={columna ?? indice}>{columna}</th>)}
            </tr>
          </thead>
          <tbody>
            {filasVisibles.length > 0
              ? filasVisibles.map((fila) => <Fragment key={clave(fila)}>{renderFila(fila)}</Fragment>)
              : <tr><td colSpan={columnas.length} className="tabla-datos-vacio">{textoVacio}</td></tr>}
          </tbody>
        </table>
      </div>

      {resultados.length > 0 && (
        <nav className="tabla-datos-paginacion" aria-label="Paginación de tabla">
          <span>Mostrando {inicio + 1}–{Math.min(inicio + filasPorPagina, resultados.length)} de {resultados.length}</span>
          <div>
            <button type="button" className="btn btn-secundario" onClick={() => setPagina(paginaActual - 1)} disabled={paginaActual === 1}>Anterior</button>
            <span>Página {paginaActual} de {totalPaginas}</span>
            <button type="button" className="btn btn-secundario" onClick={() => setPagina(paginaActual + 1)} disabled={paginaActual === totalPaginas}>Siguiente</button>
          </div>
        </nav>
      )}
    </div>
  )
}
