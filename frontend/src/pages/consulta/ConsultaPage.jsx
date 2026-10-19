import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import Alerta from '../../components/ui/Alerta.jsx'
import Boton from '../../components/ui/Boton.jsx'
import Spinner from '../../components/ui/Spinner.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import { listarPrestatarios, obtenerHistorial } from '../../services/consulta.js'
import { soles } from '../../utils/dinero.js'
import './consulta.css'

const MOTIVOS_BLOQUEO = {
  MOROSO: 'El prestatario tiene cuotas vencidas en mora.',
  EXTRAJUDICIAL: 'Tiene un expediente de cobranza extrajudicial abierto.',
  BLOQUEADO_INCIDENCIA_IDENTIDAD: 'Tiene una incidencia de identidad pendiente.',
  BLOQUEADO_REPRESENTACION_EMPRESA:
    'Empresa sin representante con DNI validado y facultades comprobadas.',
  BLOQUEADO_AUDITADO: 'La ficha está bloqueada por decisión autorizada.',
}

function nombreCompleto(prestatario) {
  return prestatario?.identidad?.nombreCompleto ?? prestatario?.identidad?.razonSocial ?? 'Sin nombre registrado'
}

function documentoDe(prestatario) {
  return prestatario?.identidad?.dni ?? prestatario?.identidad?.ruc ?? '—'
}

function fechaHora(valor) {
  return valor ? new Date(valor).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export default function ConsultaPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filtroURL = searchParams.get('q') ?? searchParams.get('dni') ?? searchParams.get('ruc') ?? ''
  const filtro = filtroURL
  const [prestatarios, setPrestatarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [errorDetalle, setErrorDetalle] = useState(null)
  const [seleccion, setSeleccion] = useState(null)
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [originando, setOriginando] = useState(false)
  const solicitud = useRef(0)
  const dialogoRef = useRef(null)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      const respuesta = await listarPrestatarios()
      if (!vigente) return
      if (respuesta.ok) setPrestatarios(respuesta.data)
      else setError(respuesta.error)
      setCargando(false)
    }
    cargar()
    return () => { vigente = false }
  }, [])

  useEffect(() => {
    if (!seleccion) return undefined
    const overflowAnterior = document.body.style.overflow
    const focoAnterior = document.activeElement
    document.body.style.overflow = 'hidden'
    dialogoRef.current?.querySelector('button')?.focus()
    function cerrarConEscape(evento) {
      if (evento.key === 'Escape') cerrarDetalle()
    }
    window.addEventListener('keydown', cerrarConEscape)
    return () => {
      window.removeEventListener('keydown', cerrarConEscape)
      document.body.style.overflow = overflowAnterior
      if (focoAnterior instanceof HTMLElement) focoAnterior.focus()
    }
  }, [seleccion])

  const filtrados = useMemo(() => {
    const termino = filtro.trim().toLocaleLowerCase('es-PE')
    if (!termino) return prestatarios
    return prestatarios.filter((p) =>
      `${nombreCompleto(p)} ${documentoDe(p)} ${p.tipo} ${p.estadoFicha}`
        .toLocaleLowerCase('es-PE')
        .includes(termino),
    )
  }, [filtro, prestatarios])

  function cambiarFiltro(valor) {
    const parametros = new URLSearchParams(searchParams)
    parametros.delete('dni')
    parametros.delete('ruc')
    if (valor) parametros.set('q', valor)
    else parametros.delete('q')
    setSearchParams(parametros, { replace: true })
  }

  async function abrirPrestatario(prestatario, modo) {
    const idSolicitud = ++solicitud.current
    setError(null)
    setErrorDetalle(null)
    setCargandoHistorial(true)
    setOriginando(false)
    setSeleccion({ prestatario, modo, historial: null })
    const respuesta = await obtenerHistorial(prestatario.id)
    if (idSolicitud !== solicitud.current) return
    setCargandoHistorial(false)
    if (!respuesta.ok) {
      setErrorDetalle(respuesta.error)
      return
    }
    setSeleccion({ prestatario, modo, historial: respuesta.data })
    if (modo === 'prestamo' && respuesta.data.elegibilidad?.elegible) setOriginando(true)
  }

  function cerrarDetalle() {
    solicitud.current += 1
    setSeleccion(null)
    setCargandoHistorial(false)
    setErrorDetalle(null)
  }

  async function actualizarHistorial() {
    if (!seleccion?.prestatario) return
    const respuesta = await obtenerHistorial(seleccion.prestatario.id)
    if (respuesta.ok) {
      setSeleccion((actual) => actual
        ? { ...actual, historial: respuesta.data }
        : actual)
    }
  }

  const historial = seleccion?.historial
  const cliente = historial?.prestatario
  const elegibilidad = historial?.elegibilidad
  const pagos = (historial?.prestamos ?? [])
    .flatMap((p) => (p.pagos ?? []).map((pago) => ({ ...pago, prestamo: p })))
    .sort((a, b) => String(b.confirmadoEn ?? b.registradoEn).localeCompare(String(a.confirmadoEn ?? a.registradoEn)))

  return (
    <section className="pagina consulta">
      <header className="pagina-cabecera">
        <p className="modulo-eyebrow">EXPEDIENTES</p>
        <h1>Directorio y vista 360</h1>
        <p>Encuentra por nombre, DNI o RUC y consulta el contexto de crédito, cupo y pagos de cada cliente.</p>
      </header>

      {error && <Alerta tipo="error">{error.message}</Alerta>}

      <Tarjeta
        className="consulta-directorio"
        titulo={`Expedientes registrados (${filtrados.length})`}
        accion={(
          <div className="consulta-filtro">
            <label htmlFor="filtro-prestatarios">Buscar por nombre o documento</label>
            <input
              id="filtro-prestatarios"
              type="search"
              placeholder="Nombre, DNI o RUC"
              value={filtro}
              onChange={(e) => cambiarFiltro(e.target.value)}
            />
          </div>
        )}
      >
        {cargando ? (
          <p className="consulta-cargando"><Spinner /> Cargando directorio de clientes...</p>
        ) : filtrados.length === 0 ? (
          <p className="consulta-vacio">{prestatarios.length ? 'No hay clientes que coincidan con el filtro.' : 'Aun no hay prestatarios registrados.'}</p>
        ) : (
          <div className="consulta-tabla-envoltura">
            <table className="consulta-tabla consulta-tabla-directorio">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{nombreCompleto(p)}</strong></td>
                    <td>{documentoDe(p)}</td>
                    <td>{p.tipo === 'EMPRESA' ? 'Empresa' : 'Persona natural'}</td>
                    <td><span className="consulta-badge consulta-badge--muted">{p.estadoFicha}</span></td>
                    <td>
                      <div className="consulta-acciones-fila">
                        <Boton
                          type="button"
                          variante="secundario"
                          onClick={() => abrirPrestatario(p, 'pagos')}
                          disabled={cargandoHistorial}
                        >Consultar pagos</Boton>
                        <Boton
                          type="button"
                          onClick={() => abrirPrestatario(p, 'prestamo')}
                          disabled={cargandoHistorial}
                        >Nuevo préstamo</Boton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {seleccion && (
        <div className="consulta-modal-fondo" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) cerrarDetalle() }}>
          <section ref={dialogoRef} className="consulta-modal" role="dialog" aria-modal="true" aria-labelledby="consulta-modal-titulo" aria-busy={cargandoHistorial}>
            <header className="consulta-modal-cabecera">
              <div>
                <span>{seleccion.modo === 'pagos' ? 'HISTORIAL DEL CLIENTE' : 'ORIGINACIÓN'}</span>
                <h2 id="consulta-modal-titulo">{nombreCompleto(seleccion.prestatario)}</h2>
                <p>{documentoDe(seleccion.prestatario)}</p>
              </div>
              <button type="button" className="consulta-modal-cerrar" aria-label="Cerrar detalle del cliente" onClick={cerrarDetalle}>×</button>
            </header>
            <div className="consulta-modal-contenido">
              {errorDetalle && <Alerta tipo="error">{errorDetalle.message}</Alerta>}
              {cargandoHistorial && <p className="consulta-cargando"><Spinner /> Cargando datos del cliente...</p>}

      {historial && cliente && (
        <>
          <Tarjeta titulo={seleccion.modo === 'pagos' ? 'Datos y pagos del cliente' : 'Datos del cliente'}>
            <div className="consulta-cabecera">
              <div>
                <h3>{nombreCompleto({ identidad: cliente.identidad })}</h3>
                <p className="consulta-documento">
                  {cliente.tipo === 'PERSONA_NATURAL' ? 'DNI' : 'RUC'} {documentoDe({ identidad: cliente.identidad })}
                  {' · '}Ficha {cliente.estadoFicha}
                  {cliente.tipo === 'EMPRESA' && cliente.identidad?.estadoRuc ? ` · RUC ${cliente.identidad.estadoRuc}` : ''}
                </p>
                <span className={`consulta-badge consulta-badge--${elegibilidad?.clasificacion === 'NUEVO' ? 'ok' : 'info'}`}>
                  {elegibilidad?.clasificacion ?? '—'}
                </span>
              </div>
              <dl className="consulta-cupo">
                <div><dt>Límite</dt><dd>{soles(elegibilidad?.limite ?? 0)}</dd></div>
                <div><dt>Ocupado</dt><dd>{soles(elegibilidad?.ocupado ?? 0)}</dd></div>
                <div className="consulta-cupo-disponible"><dt>Disponible</dt><dd>{soles(elegibilidad?.disponible ?? 0)}</dd></div>
              </dl>
            </div>
            {elegibilidad?.bloqueos?.length > 0 && (
              <Alerta tipo="error">
                {elegibilidad.bloqueos.map((b) => MOTIVOS_BLOQUEO[b] ?? b).join(' ')}
              </Alerta>
            )}
          </Tarjeta>

          {seleccion.modo === 'pagos' ? (
            <Tarjeta titulo={`Pagos registrados (${pagos.length})`}>
              {pagos.length === 0 ? (
                <p className="consulta-vacio">Este cliente todavía no tiene pagos registrados.</p>
              ) : (
                <div className="consulta-tabla-envoltura">
                  <table className="consulta-tabla">
                    <thead><tr><th>Fecha</th><th>Préstamo</th><th>Monto</th><th>Medio</th><th>Referencia</th><th>Estado</th></tr></thead>
                    <tbody>
                      {pagos.map((pago) => (
                        <tr key={pago.id}>
                          <td>{fechaHora(pago.confirmadoEn ?? pago.registradoEn)}</td>
                          <td>{soles(pago.prestamo.principal)} · {pago.prestamo.estado}</td>
                          <td><strong>{soles(pago.monto)}</strong></td>
                          <td>{pago.medio}</td>
                          <td>{pago.referencia ?? '—'}</td>
                          <td><span className={`consulta-badge consulta-badge--${pago.estado === 'CONFIRMADO' ? 'ok' : pago.estado === 'RECHAZADO' || pago.estado === 'REVERSADO' ? 'muted' : 'info'}`}>{pago.estado}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tarjeta>
          ) : (
            <>
              <Tarjeta titulo="Elegibilidad para nuevo préstamo">
                <p className="consulta-vacio">
                  {elegibilidad?.elegible
                    ? `El cliente puede solicitar un préstamo de hasta ${soles(elegibilidad.disponible)} según su cupo disponible.`
                    : MOTIVOS_BLOQUEO[elegibilidad?.motivo] ?? elegibilidad?.motivo ?? 'El cliente no es elegible actualmente.'}
                </p>
              </Tarjeta>
              {elegibilidad?.elegible && originando && (
                <Tarjeta titulo="Asignar nuevo préstamo">
                  <PrestamoForm prestatarioId={cliente.id} onOrigenExitoso={actualizarHistorial} />
                </Tarjeta>
              )}
            </>
          )}

          <Tarjeta titulo={`Préstamos registrados (${historial.prestamos.length})`}>
            {historial.prestamos.length === 0 ? (
              <p className="consulta-vacio">Sin préstamos registrados.</p>
            ) : (
              <div className="consulta-tabla-envoltura">
                <table className="consulta-tabla">
                  <thead><tr><th>Sucursal</th><th>Principal</th><th>Plazo</th><th>Origen</th><th>Estado</th></tr></thead>
                  <tbody>
                    {historial.prestamos.map((p) => (
                      <tr key={p.id}>
                        <td>{p.sucursal ?? '—'}</td><td>{soles(p.principal)}</td><td>{p.plazoMeses} meses</td>
                        <td>{p.fechaOriginacion}</td><td>{p.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>
        </>
      )}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
