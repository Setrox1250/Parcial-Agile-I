import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import Alerta from '../../components/ui/Alerta.jsx'
import Boton from '../../components/ui/Boton.jsx'
import Spinner from '../../components/ui/Spinner.jsx'
import Modal from '../../components/ui/Modal.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import RegistrarCobro from '../../components/cobranza/RegistrarCobro.jsx'
import { listarPrestatarios, obtenerHistorial } from '../../services/consulta.js'
import { normalizarPrestamo, estadoCuota as estadoCuotaDerivado } from '../../utils/cobranza.js'
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

function badgeCuota(estado) {
  if (estado === 'PAGADA') return 'ok'
  if (estado === 'VENCIDA') return 'error'
  if (estado === 'PARCIAL') return 'info'
  return 'muted'
}

function PrestamoFila({ prestamo, expandido, onAlternar, onCobrar }) {
  const { sucursal, principal, plazoMeses, tea, fechaOriginacion, estado, desembolso } = prestamo
  const cuotas = prestamo.cuotas ?? []
  const pagos = prestamo.pagos ?? []
  const saldoPendiente = cuotas.reduce((total, c) => total + Number(c.saldo), 0)
  const cobrable = estado === 'ACTIVO' && saldoPendiente > 0.005

  return (
    <>
      <tr className="consulta-fila" onClick={onAlternar}>
        <td className="consulta-expandir" aria-hidden="true">{expandido ? '▾' : '▸'}</td>
        <td>{sucursal ?? '—'}</td>
        <td><strong>{soles(principal)}</strong></td>
        <td>{plazoMeses} m</td>
        <td>{(Number(tea) * 100).toFixed(2)} %</td>
        <td>{String(fechaOriginacion ?? '').slice(0, 10)}</td>
        <td>{estado}</td>
        <td>{soles(saldoPendiente)}</td>
      </tr>
      {expandido && (
        <tr className="consulta-detalle">
          <td colSpan={8}>
            <div className="consulta-detalle-cabecera">
              <h4>Cuotas del préstamo</h4>
              {cobrable && (
                <Boton
                  type="button"
                  onClick={(evento) => {
                    evento.stopPropagation()
                    onCobrar()
                  }}
                >
                  Registrar cobro
                </Boton>
              )}
            </div>
            {desembolso && (
              <p className="consulta-desembolso">
                Desembolsado {soles(desembolso.importe)} · {desembolso.metodo}
                {desembolso.referencia ? ` · Ref. ${desembolso.referencia}` : ''} ·{' '}
                {String(desembolso.fecha).slice(0, 10)}
              </p>
            )}
            {cuotas.length === 0 ? (
              <p className="consulta-vacio">Este préstamo no tiene un cronograma de cuotas disponible.</p>
            ) : (
              <div className="consulta-tabla-envoltura">
                <table className="consulta-cronograma">
                  <thead>
                    <tr>
                      <th scope="col">N.º</th>
                      <th scope="col">Vencimiento</th>
                      <th scope="col">Capital</th>
                      <th scope="col">Interés</th>
                      <th scope="col">Total</th>
                      <th scope="col">Abonado</th>
                      <th scope="col">Saldo</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuotas.map((c) => {
                      const estadoCuotaActual = estadoCuotaDerivado(c)
                      return (
                        <tr key={c.numero}>
                          <td>{c.numero}</td>
                          <td>{String(c.vencimiento ?? '').slice(0, 10)}</td>
                          <td>{soles(c.capitalProgramado)}</td>
                          <td>{soles(c.interesProgramado)}</td>
                          <td>{soles(c.totalProgramado)}</td>
                          <td>{soles(c.abonado)}</td>
                          <td><strong>{soles(c.saldo)}</strong></td>
                          <td>
                            <span className={`consulta-badge consulta-badge--${badgeCuota(estadoCuotaActual)}`}>
                              {estadoCuotaActual}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <h4>Pagos del préstamo ({pagos.length})</h4>
            {pagos.length === 0 ? (
              <p className="consulta-vacio">Sin cobros registrados para este préstamo.</p>
            ) : (
              <ul className="consulta-timeline">
                {pagos.map((pago) => (
                  <li key={pago.id}>
                    <span className="consulta-timeline-fecha">{fechaHora(pago.confirmadoEn ?? pago.registradoEn)}</span>
                    <strong>{soles(pago.monto)}</strong>
                    <span>{pago.medio}</span>
                    {pago.referencia && <span className="consulta-ref">Ref. {pago.referencia}</span>}
                    <span
                      className={`consulta-badge consulta-badge--${pago.estado === 'CONFIRMADO' ? 'ok' : pago.estado === 'RECHAZADO' || pago.estado === 'REVERSADO' ? 'muted' : 'info'}`}
                    >
                      {pago.estado}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
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
  const [pestana, setPestana] = useState('prestamos')
  const [expandido, setExpandido] = useState(null)
  const [cobroDe, setCobroDe] = useState(null)
  const solicitud = useRef(0)

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
    setExpandido(null)
    setCobroDe(null)
    setPestana(modo === 'prestamo' ? 'originacion' : 'pagos')
    setSeleccion({ prestatario, modo, historial: null })
    const respuesta = await obtenerHistorial(prestatario.id)
    if (idSolicitud !== solicitud.current) return
    setCargandoHistorial(false)
    if (!respuesta.ok) {
      setErrorDetalle(respuesta.error)
      return
    }
    setSeleccion({ prestatario, modo, historial: respuesta.data })
  }

  function cerrarDetalle() {
    solicitud.current += 1
    setSeleccion(null)
    setCargandoHistorial(false)
    setErrorDetalle(null)
    setExpandido(null)
    setCobroDe(null)
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
  const prestamos = useMemo(() => historial?.prestamos ?? [], [historial])
  const expedientes = historial?.expedientes ?? []
  const pagos = prestamos
    .flatMap((p) => (p.pagos ?? []).map((pago) => ({ ...pago, prestamo: p })))
    .sort((a, b) => String(b.confirmadoEn ?? b.registradoEn).localeCompare(String(a.confirmadoEn ?? a.registradoEn)))
  const prestamosCobrables = useMemo(() => prestamos.map(normalizarPrestamo), [prestamos])

  const pestanas = [
    ...(seleccion?.modo === 'prestamo' ? [{ id: 'originacion', texto: 'Nuevo préstamo' }] : []),
    { id: 'prestamos', texto: `Préstamos (${prestamos.length})` },
    { id: 'pagos', texto: `Pagos (${pagos.length})` },
    { id: 'expedientes', texto: `Expedientes (${expedientes.length})` },
  ]

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
        <Modal
          className="consulta-modal"
          eyebrow={seleccion.modo === 'pagos' ? 'EXPEDIENTE 360' : 'ORIGINACIÓN'}
          titulo={nombreCompleto(seleccion.prestatario)}
          subtitulo={documentoDe(seleccion.prestatario)}
          onCerrar={cerrarDetalle}
          busy={cargandoHistorial}
        >
          {errorDetalle && <Alerta tipo="error">{errorDetalle.message}</Alerta>}
          {cargandoHistorial && <p className="consulta-cargando"><Spinner /> Cargando datos del cliente...</p>}

          {historial && cliente && (
            <>
              <div className="ficha-resumen">
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
              </div>

              <nav className="ficha-pestanas" aria-label="Secciones del expediente">
                {pestanas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`ficha-pestana ${pestana === p.id ? 'ficha-pestana--activa' : ''}`}
                    aria-current={pestana === p.id ? 'page' : undefined}
                    onClick={() => setPestana(p.id)}
                  >
                    {p.texto}
                  </button>
                ))}
              </nav>

              <div className="ficha-panel">
                {pestana === 'originacion' && (
                  <section className="ficha-seccion">
                    {elegibilidad?.elegible ? (
                      <>
                        <h3>Elegibilidad aprobada</h3>
                        <p className="consulta-vacio">
                          El cliente puede solicitar un préstamo de hasta {soles(elegibilidad.disponible)} según su cupo disponible.
                        </p>
                        <PrestamoForm prestatarioId={cliente.id} onOrigenExitoso={actualizarHistorial} />
                      </>
                    ) : (
                      <>
                        <h3>Sin elegibilidad para nuevo préstamo</h3>
                        <Alerta tipo="error">
                          {MOTIVOS_BLOQUEO[elegibilidad?.motivo] ?? elegibilidad?.motivo ?? 'El cliente no es elegible actualmente.'}
                        </Alerta>
                      </>
                    )}
                  </section>
                )}

                {pestana === 'prestamos' && (
                  <section className="ficha-seccion">
                    <h3>Préstamos registrados ({prestamos.length})</h3>
                    <p className="ficha-seccion-nota">
                      Expande un préstamo para ver sus cuotas y registrar un cobro sobre él.
                    </p>
                    {prestamos.length === 0 ? (
                      <p className="consulta-vacio">Sin préstamos registrados.</p>
                    ) : (
                      <div className="consulta-tabla-envoltura">
                        <table className="consulta-tabla">
                          <thead>
                            <tr>
                              <th scope="col" aria-label="Expandir" />
                              <th scope="col">Sucursal</th>
                              <th scope="col">Principal</th>
                              <th scope="col">Plazo</th>
                              <th scope="col">TEA</th>
                              <th scope="col">Origen</th>
                              <th scope="col">Estado</th>
                              <th scope="col">Saldo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prestamos.map((p) => (
                              <PrestamoFila
                                key={p.id}
                                prestamo={p}
                                expandido={expandido === p.id}
                                onAlternar={() => setExpandido(expandido === p.id ? null : p.id)}
                                onCobrar={() => setCobroDe(p.id)}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {pestana === 'pagos' && (
                  <section className="ficha-seccion">
                    <h3>Pagos registrados ({pagos.length})</h3>
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
                                <td>
                                  <span className={`consulta-badge consulta-badge--${pago.estado === 'CONFIRMADO' ? 'ok' : pago.estado === 'RECHAZADO' || pago.estado === 'REVERSADO' ? 'muted' : 'info'}`}>
                                    {pago.estado}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {pestana === 'expedientes' && (
                  <section className="ficha-seccion">
                    <h3>Expedientes de cobranza ({expedientes.length})</h3>
                    {expedientes.length === 0 ? (
                      <p className="consulta-vacio">Sin expedientes extrajudiciales registrados.</p>
                    ) : (
                      <>
                        <Alerta tipo="info">
                          Seguimiento interno de cobranza; no equivale a un proceso judicial. El expediente
                          es inmutable y permanece en el historial aunque se regularice (RN-28).
                        </Alerta>
                        <ul className="consulta-expedientes">
                          {expedientes.map((x) => (
                            <li key={x.id}>
                              <div><dt>Inicio de mora</dt><dd>{x.inicioMora ?? '—'}</dd></div>
                              <div><dt>Escalamiento (1 año)</dt><dd>{x.fechaEscalamiento}</dd></div>
                              <div><dt>Estado</dt><dd>{x.estado}</dd></div>
                              <div><dt>Responsable</dt><dd>{x.responsable ?? 'Sin asignar'}</dd></div>
                              {x.accion && <div><dt>Acción</dt><dd>{x.accion}</dd></div>}
                              {x.resultado && <div><dt>Resultado</dt><dd>{x.resultado}</dd></div>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </Modal>
      )}

      {cobroDe && (
        <RegistrarCobro
          prestamos={prestamosCobrables}
          prestamoInicial={cobroDe}
          onRegistrado={() => actualizarHistorial()}
          onCerrar={() => setCobroDe(null)}
        />
      )}
    </section>
  )
}
