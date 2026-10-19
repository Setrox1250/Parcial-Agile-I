import { useCallback, useEffect, useState } from 'react'
import { listarCobranza, registrarPago, verificarPago } from '../../services/pagos'

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
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cambiar = (campo) => (e) => setForm({ ...form, [campo]: e.target.value })

  const registrar = async (e) => {
    e.preventDefault()
    setError(null)
    setMensaje(null)

    const monto = Number(form.monto)
    if (!Number.isFinite(monto) || monto <= 0) {
      setError('El monto debe ser mayor que cero.')
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

  return (
    <section>
      <h1>Cobranza</h1>

      {error && <div className="aviso aviso-error">{error}</div>}
      {mensaje && <div className="aviso aviso-ok">{mensaje}</div>}

      <div className="tarjeta">
        <h2>Registrar cobro</h2>
        <p className="cargando">
          El efectivo se confirma al registrarlo; la transferencia queda pendiente de verificación
          del abono (RN-23).
        </p>
        <form className="formulario" onSubmit={registrar}>
          <label>
            Préstamo a cobrar
            <select value={form.prestamoId} onChange={cambiar('prestamoId')} required>
              <option value="">— Seleccione un préstamo activo —</option>
              {prestamos.map((p) => (
                <option key={p.id} value={p.id}>
                  {nombrePrestamo(p)} · {PEN.format(p.principal)} · {p.sucursal ?? '—'}
                </option>
              ))}
            </select>
          </label>

          {prestamoSeleccionado && (
            <p className="cargando">
              Saldo insoluto registrado: {PEN.format(prestamoSeleccionado.principal)} · Desembolsado
              el {fecha(prestamoSeleccionado.desembolsadoEn)}
            </p>
          )}

          <label>
            Monto (PEN)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.monto}
              onChange={cambiar('monto')}
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

          <button type="submit" className="btn" disabled={enviando || prestamos.length === 0}>
            {enviando ? 'Registrando…' : 'Registrar cobro'}
          </button>
          {prestamos.length === 0 && (
            <p className="cargando">No hay préstamos activos en tu sucursal para cobrar.</p>
          )}
        </form>
      </div>

      <div className="tarjeta">
        <h2>Transferencias por verificar</h2>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : pendientes.length === 0 ? (
          <p className="cargando">Sin transferencias pendientes de verificación.</p>
        ) : (
          <table className="tabla">
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
          </table>
        )}
      </div>

      <div className="tarjeta">
        <h2>Historial de cobros</h2>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : recientes.length === 0 ? (
          <p className="cargando">Todavía no hay cobros registrados.</p>
        ) : (
          <table className="tabla">
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
          </table>
        )}
        <p className="cargando">
          Los cobros confirmados se imputarán a capital e intereses del cronograma (CA-19) cuando
          HU-05 publique las cuotas; hasta entonces figura «Por imputar».
        </p>
      </div>
    </section>
  )
}
