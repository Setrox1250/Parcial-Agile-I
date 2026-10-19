import { useCallback, useEffect, useRef, useState } from 'react'
import { listarCobranza, registrarPago, verificarPago } from '../../services/pagos'
import { buscarPrestatario, obtenerHistorial } from '../../services/consulta.js'

const PEN = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

const FORM_VACIO = {
  prestamoId: '',
  monto: '',
  medio: 'EFECTIVO',
  referencia: '',
}

const ESTADOS = {
  PENDIENTE_VERIFICACION: 'Pendiente de verificación',
  CONFIRMADO: 'Confirmado',
  RECHAZADO: 'Rechazado',
  REVERSADO: 'Revertido',
  REGISTRADO: 'Registrado',
}

function fecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
}

function nombrePrestamo(prestamo) {
  const ficha = prestamo?.prestatario
  if (!ficha) return prestamo?.id?.slice(0, 8) ?? '—'
  return `${ficha.documento ?? '—'} · ${ficha.nombre ?? '—'}`
}

export default function CobranzasPage() {
  const [prestamos, setPrestamos] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [recientes, setRecientes] = useState([])
  const [form, setForm] = useState(FORM_VACIO)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [modalCobro, setModalCobro] = useState(false)
  const [cuotasPorPrestamo, setCuotasPorPrestamo] = useState({})
  const [cargandoCuotas, setCargandoCuotas] = useState(false)
  const [errorCuotas, setErrorCuotas] = useState(null)
  const [cuotasSeleccionadas, setCuotasSeleccionadas] = useState([])
  const solicitudCuotas = useRef(0)
  const dialogoRef = useRef(null)

  // RN-31: mismo cobro reenviado -> un solo pago (se renueva tras cada cobro).
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID())

  const cargar = useCallback(async () => {
    setError(null)
    const respuesta = await listarCobranza()
    if (!respuesta.ok) {
      setError(respuesta.error.message)
    } else {
      setPrestamos(respuesta.data.prestamos)
      setPendientes(respuesta.data.pendientes)
      setRecientes(respuesta.data.recientes)
      setCuotasPorPrestamo({})
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cerrarModalCobro = useCallback(() => {
    if (enviando) return
    solicitudCuotas.current += 1
    setCargandoCuotas(false)
    setModalCobro(false)
  }, [enviando])

  useEffect(() => {
    if (!modalCobro) return undefined
    const overflowAnterior = document.body.style.overflow
    const focoAnterior = document.activeElement
    document.body.style.overflow = 'hidden'
    dialogoRef.current?.querySelector('button')?.focus()
    function cerrarConEscape(evento) {
      if (evento.key === 'Escape' && !enviando) cerrarModalCobro()
    }
    window.addEventListener('keydown', cerrarConEscape)
    return () => {
      window.removeEventListener('keydown', cerrarConEscape)
      document.body.style.overflow = overflowAnterior
      if (focoAnterior instanceof HTMLElement) focoAnterior.focus()
    }
  }, [modalCobro, enviando, cerrarModalCobro])

  const cambiar = (campo) => (e) => setForm((actual) => ({ ...actual, [campo]: e.target.value }))

  const cambiarPrestamo = async (e) => {
    const prestamoId = e.target.value
    const prestamo = prestamos.find((p) => p.id === prestamoId)
    const solicitud = ++solicitudCuotas.current
    setErrorCuotas(null)
    setCuotasSeleccionadas([])
    setForm((actual) => ({
      ...actual,
      prestamoId,
      monto: '',
    }))

    if (!prestamo) {
      setCargandoCuotas(false)
      return
    }

    let cuotas = cuotasPorPrestamo[prestamoId] ?? prestamo.cuotas
    if (!cuotas) {
      setCargandoCuotas(true)
      const esEmpresa = prestamo.prestatario?.tipo === 'EMPRESA'
      const documento = prestamo.prestatario?.documento
      const busqueda = documento
        ? await buscarPrestatario(esEmpresa ? { ruc: documento } : { dni: documento })
        : { ok: false, error: { message: 'No se encontró el documento del prestatario.' } }

      if (solicitud !== solicitudCuotas.current) return
      if (!busqueda.ok) {
        setErrorCuotas(busqueda.error?.message ?? 'No se pudo cargar el cronograma de cuotas.')
        setCargandoCuotas(false)
        return
      }

      const historial = await obtenerHistorial(busqueda.data.prestatarioId)
      if (solicitud !== solicitudCuotas.current) return
      if (!historial.ok) {
        setErrorCuotas(historial.error?.message ?? 'No se pudo cargar el cronograma de cuotas.')
        setCargandoCuotas(false)
        return
      }

      const prestamoHistorial = historial.data.prestamos.find((p) => p.id === prestamoId)
      cuotas = prestamoHistorial?.cuotas?.map((cuota) => ({
        numero: cuota.numero,
        vencimiento: cuota.vencimiento,
        montoProgramado: Number(cuota.totalProgramado),
        montoAbonado: Number(cuota.abonado),
        saldo: Number(cuota.saldo),
        estado: cuota.saldo <= 0.005
          ? 'PAGADA'
          : cuota.vencimiento < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
            ? 'VENCIDA'
            : cuota.abonado > 0
              ? 'PARCIAL'
              : 'PENDIENTE',
      }))

      if (!cuotas) {
        setErrorCuotas('Este préstamo no tiene un cronograma de cuotas disponible.')
        setCargandoCuotas(false)
        return
      }
      setCuotasPorPrestamo((actual) => ({ ...actual, [prestamoId]: cuotas }))
    }

    const siguienteCuota = cuotas.find((cuota) => cuota.saldo > 0)
    setCuotasSeleccionadas(siguienteCuota ? [siguienteCuota.numero] : [])
    setForm((actual) => actual.prestamoId === prestamoId
      ? { ...actual, monto: siguienteCuota ? siguienteCuota.saldo.toFixed(2) : '' }
      : actual)
    setCargandoCuotas(false)
  }

  const registrar = async (e) => {
    e.preventDefault()
    setError(null)
    setMensaje(null)

    const monto = Number(form.monto)
    if (!Number.isFinite(monto) || monto <= 0) {
      setError('El monto debe ser mayor que cero.')
      return
    }
    const saldoTotalPendiente = cuotas.reduce(
      (total, cuota) => total + cuota.saldo,
      0,
    )
    if (Number.isFinite(saldoTotalPendiente) && monto > saldoTotalPendiente + 0.005) {
      setError(`El monto supera el saldo pendiente del cronograma (${PEN.format(saldoTotalPendiente)}).`)
      return
    }
    if (form.medio === 'TRANSFERENCIA' && !form.referencia.trim()) {
      setError('La transferencia requiere la referencia del abono.')
      return
    }

    setEnviando(true)
    try {
      const respuesta = await registrarPago({
        prestamoId: form.prestamoId,
        monto,
        medio: form.medio,
        referencia: form.medio === 'TRANSFERENCIA' ? form.referencia : '',
        idempotencyKey: claveIdempotencia,
      })
      if (!respuesta.ok) {
        setError(respuesta.error.message)
        return
      }

      const { pago, idempotente } = respuesta.data
      if (idempotente) {
        setMensaje('Este cobro ya estaba registrado: no se duplicó (idempotencia).')
      } else if (pago.estado === 'CONFIRMADO') {
        setMensaje(`Cobro de ${PEN.format(pago.monto)} registrado y confirmado.`)
      } else {
        setMensaje(`Cobro de ${PEN.format(pago.monto)} registrado: aguarda verificación del abono.`)
      }

      setForm(FORM_VACIO)
      setClaveIdempotencia(crypto.randomUUID())
      await cargar()
      setModalCobro(false)
    } finally {
      setEnviando(false)
    }
  }

  const verificar = async (pago, accion) => {
    setError(null)
    setMensaje(null)
    const respuesta = await verificarPago(pago.id, accion)
    if (!respuesta.ok) {
      setError(respuesta.error.message)
      return
    }
    setMensaje(
      accion === 'CONFIRMAR'
        ? `Abono de ${PEN.format(pago.monto)} confirmado.`
        : `Abono de ${PEN.format(pago.monto)} rechazado.`,
    )
    await cargar()
  }

  const transferencia = form.medio === 'TRANSFERENCIA'
  const prestamoSeleccionado = prestamos.find((p) => p.id === form.prestamoId)
  const cuotas = cuotasPorPrestamo[form.prestamoId] ?? prestamoSeleccionado?.cuotas ?? []
  const siguienteCuota = cuotas.find((cuota) => cuota.saldo > 0)
  const cuotasPendientes = cuotas.filter((cuota) => cuota.saldo > 0)
  const totalCuotasSeleccionadas = cuotasPendientes
    .filter((cuota) => cuotasSeleccionadas.includes(cuota.numero))
    .reduce((total, cuota) => total + cuota.saldo, 0)

  const seleccionarCuota = (numero, seleccionada) => {
    const indice = cuotasPendientes.findIndex((cuota) => cuota.numero === numero)
    const seleccion = seleccionada
      ? cuotasPendientes.slice(0, indice + 1).map((cuota) => cuota.numero)
      : cuotasPendientes.slice(0, indice).map((cuota) => cuota.numero)
    setCuotasSeleccionadas(seleccion)
    const total = cuotasPendientes
      .filter((cuota) => seleccion.includes(cuota.numero))
      .reduce((suma, cuota) => suma + cuota.saldo, 0)
    setForm((actual) => ({ ...actual, monto: total ? total.toFixed(2) : '' }))
  }

  return (
    <section className="modulo-operativo">
      <header className="modulo-cabecera">
        <div>
          <p className="modulo-eyebrow">OPERACIÓN DE CARTERA</p>
          <h1>Cobranza</h1>
          <p>Registra pagos, valida abonos por transferencia y conserva una traza por préstamo.</p>
        </div>
        <span className="modulo-contador">{pendientes.length} por verificar</span>
      </header>

      {error && !modalCobro && <div className="aviso aviso-error">{error}</div>}
      {mensaje && !modalCobro && <div className="aviso aviso-ok">{mensaje}</div>}

      <div className="tarjeta cobranza-abrir accion-destacada">
        <div>
        <h2>Registrar cobro</h2>
        <p className="cargando">
          El efectivo se confirma al registrarlo; la transferencia queda pendiente de verificación
          del abono (RN-23).
        </p>
        </div>
        <button type="button" className="btn" onClick={() => { setError(null); setMensaje(null); setModalCobro(true) }} disabled={cargando || prestamos.length === 0}>Registrar cobro</button>
      </div>

      {modalCobro && (
        <div className="flujo-modal-fondo" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) cerrarModalCobro() }}>
          <section ref={dialogoRef} className="flujo-modal" role="dialog" aria-modal="true" aria-labelledby="cobranza-modal-titulo" aria-busy={enviando || cargandoCuotas}>
            <header className="flujo-modal-cabecera">
              <div><span>REGISTRO DE PAGO</span><h2 id="cobranza-modal-titulo">Registrar cobro</h2></div>
              <button type="button" className="flujo-modal-cerrar" aria-label="Cerrar registro de cobro" onClick={cerrarModalCobro} disabled={enviando}>×</button>
            </header>
            <div className="flujo-modal-contenido">
              {error && <div className="aviso aviso-error">{error}</div>}
              {mensaje && <div className="aviso aviso-ok">{mensaje}</div>}
              <div className="tarjeta">
        <form className="formulario" onSubmit={registrar}>
          <label>
            Préstamo a cobrar
            <select value={form.prestamoId} onChange={cambiarPrestamo} required>
              <option value="">— Seleccione un préstamo activo —</option>
              {prestamos.map((p) => (
                <option key={p.id} value={p.id}>
                  {nombrePrestamo(p)} · Saldo {PEN.format(p.capitalInsoluto ?? p.principal)} · {p.sucursal ?? '—'}
                </option>
              ))}
            </select>
          </label>

          {prestamoSeleccionado && (
            <>
              <p className="cargando cobranza-saldo-prestamo">
                Capital insoluto: {PEN.format(prestamoSeleccionado.capitalInsoluto ?? prestamoSeleccionado.principal)} · Desembolsado el{' '}
                {fecha(prestamoSeleccionado.desembolsadoEn)}
              </p>

              <div className="cobranza-cronograma">
                <div className="cobranza-cronograma-cabecera">
                  <div>
                    <h3>Cuotas del préstamo</h3>
                    <p>Marca una o varias cuotas pendientes para sumar el monto del pago.</p>
                  </div>
                  {totalCuotasSeleccionadas > 0 && (
                    <span className="cobranza-monto-sugerido">
                      Seleccionado: {PEN.format(totalCuotasSeleccionadas)}
                    </span>
                  )}
                </div>
                {cargandoCuotas ? (
                  <p className="cargando">Cargando el cronograma del cliente…</p>
                ) : errorCuotas ? (
                  <div className="aviso aviso-error">{errorCuotas}</div>
                ) : cuotas.length === 0 ? (
                  <p className="cargando">Este préstamo no tiene un cronograma de cuotas disponible.</p>
                ) : (
                  <div className="cobranza-tabla-envoltura">
                    <table className="tabla cobranza-tabla-cuotas">
                      <thead>
                        <tr>
                          <th>Incluir</th>
                          <th>Cuota</th>
                          <th>Vencimiento</th>
                          <th>Programado</th>
                          <th>Abonado</th>
                          <th>Pendiente</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cuotas.map((cuota) => (
                          <tr
                            key={cuota.numero}
                            className={cuota.numero === siguienteCuota?.numero ? 'cobranza-cuota-siguiente' : ''}
                          >
                            <td>
                              {cuota.saldo > 0 && (
                                <input
                                  type="checkbox"
                                  aria-label={`Incluir cuota ${cuota.numero}`}
                                  checked={cuotasSeleccionadas.includes(cuota.numero)}
                                  onChange={(e) => seleccionarCuota(cuota.numero, e.target.checked)}
                                />
                              )}
                            </td>
                            <td>{cuota.numero}</td>
                            <td>{cuota.vencimiento}</td>
                            <td>{PEN.format(cuota.montoProgramado)}</td>
                            <td>{PEN.format(cuota.montoAbonado)}</td>
                            <td><strong>{PEN.format(cuota.saldo)}</strong></td>
                            <td><span className={`cobranza-estado-cuota cobranza-estado-cuota--${cuota.estado.toLowerCase()}`}>{cuota.estado}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="cobranza-nota-cuotas">
                  {cuotasSeleccionadas.length} cuota(s) seleccionada(s). El pago se imputa por antigüedad, por eso solo se pueden seleccionar cuotas consecutivas. Puedes ajustar el monto para registrar un abono parcial.
                </p>
              </div>
            </>
          )}

          <label>
            Monto (PEN)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.monto}
              onChange={cambiar('monto')}
              disabled={cargandoCuotas || enviando}
              required
            />
          </label>

          <label>
            Medio
            <select value={form.medio} onChange={cambiar('medio')}>
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
          </label>

          {transferencia && (
            <label>
              Referencia del abono
              <input
                type="text"
                value={form.referencia}
                onChange={cambiar('referencia')}
                placeholder="CCI, operación o voucher"
                required
              />
            </label>
          )}

          <button type="submit" className="btn" disabled={enviando || cargandoCuotas || prestamos.length === 0}>
            {enviando ? 'Registrando…' : 'Registrar cobro'}
          </button>
          {prestamos.length === 0 && (
            <p className="cargando">No hay préstamos activos en tu sucursal para cobrar.</p>
          )}
        </form>
      </div>
            </div>
          </section>
        </div>
      )}

      <div className="tarjeta cola-operativa">
        <div className="cola-operativa-cabecera"><div><p className="tarjeta-eyebrow">VALIDACIÓN</p><h2>Transferencias por verificar</h2></div><span>El saldo cambia solo al confirmar</span></div>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : pendientes.length === 0 ? (
          <p className="cargando">Sin transferencias pendientes de verificación.</p>
        ) : (
          <div className="tabla-envoltura"><table className="tabla">
            <thead>
              <tr>
                <th>Registrado</th>
                <th>Prestatario</th>
                <th>Monto</th>
                <th>Referencia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => (
                <tr key={p.id}>
                  <td>{fecha(p.registradoEn)}</td>
                  <td>{p.prestatario?.nombre ?? '—'}</td>
                  <td>{PEN.format(p.monto)}</td>
                  <td>{p.referencia ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => verificar(p, 'CONFIRMAR')}
                    >
                      Confirmar abono
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn-secundario"
                      onClick={() => verificar(p, 'RECHAZAR')}
                    >
                      Rechazar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="tarjeta cola-operativa">
        <div className="cola-operativa-cabecera"><div><p className="tarjeta-eyebrow">MOVIMIENTOS RECIENTES</p><h2>Historial de cobros</h2></div><span>{recientes.length} registros</span></div>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : recientes.length === 0 ? (
          <p className="cargando">Todavía no hay cobros registrados.</p>
        ) : (
          <div className="tabla-envoltura"><table className="tabla">
            <thead>
              <tr>
                <th>Registrado</th>
                <th>Prestatario</th>
                <th>Monto</th>
                <th>Medio</th>
                <th>Estado</th>
                <th>Confirmado</th>
                <th>Imputado</th>
              </tr>
            </thead>
            <tbody>
              {recientes.map((p) => (
                <tr key={p.id}>
                  <td>{fecha(p.registradoEn)}</td>
                  <td>{p.prestatario?.nombre ?? '—'}</td>
                  <td>{PEN.format(p.monto)}</td>
                  <td>
                    {p.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
                    {p.referencia ? ` (${p.referencia})` : ''}
                  </td>
                  <td>
                    <span className="etiqueta">{ESTADOS[p.estado] ?? p.estado}</span>
                  </td>
                  <td>{fecha(p.confirmadoEn)}</td>
                  <td>{p.imputadoEn ? fecha(p.imputadoEn) : 'Por imputar'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="cargando">
          Los cobros confirmados se distribuyen entre capital e intereses en orden de vencimiento.
          Las transferencias pendientes no reducen el saldo hasta que se verifique el abono.
        </p>
      </div>
    </section>
  )
}
