import { useRef, useState } from 'react'
import Modal from '../ui/Modal.jsx'
import Dialogo from '../ui/Dialogo.jsx'
import { registrarPago } from '../../services/pagos.js'
import { buscarPrestatario, obtenerHistorial } from '../../services/consulta.js'
import { normalizarCuotas } from '../../utils/cobranza.js'

const PEN = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

const PASOS = [
  { titulo: 'Datos del cobro', descripcion: 'Cuotas, monto y medio' },
  { titulo: 'Confirmación', descripcion: 'Revisar antes de registrar' },
  { titulo: 'Resultado', descripcion: 'Estado del cobro' },
]

function fecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
}

function etiquetaPrestamo(prestamo) {
  const ficha = prestamo?.prestatario
  if (ficha) return `${ficha.documento ?? '—'} · ${ficha.nombre ?? '—'}`
  return `${prestamo?.sucursal ?? '—'} · ${PEN.format(prestamo?.capitalInsoluto ?? prestamo?.principal ?? 0)}`
}

// Registro de cobro (HU-07) compartido entre Cobranza y la vista 360.
//   prestamos       -> lista de préstamos cobrables (ya normalizados)
//   prestamoInicial -> id preseleccionado (expediente 360); si existe no se muestra select
//   onRegistrado    -> se invoca tras registrar el pago (recargar datos)
//   onCerrar        -> cierra el modal
// Flujo por pasos: Datos -> Confirmación (modal) -> Resultado (información).
export default function RegistrarCobro({ prestamos, prestamoInicial, onRegistrado, onCerrar }) {
  const inicial = prestamos.find((p) => p.id === prestamoInicial) ?? null
  const cuotasIniciales = inicial?.cuotas ?? []
  const siguienteInicial = cuotasIniciales.find((c) => c.saldo > 0)

  const [paso, setPaso] = useState('datos')
  const [prestamoId, setPrestamoId] = useState(inicial?.id ?? '')
  const [cuotas, setCuotas] = useState(cuotasIniciales)
  const [cargandoCuotas, setCargandoCuotas] = useState(false)
  const [seleccion, setSeleccion] = useState(siguienteInicial ? [siguienteInicial.numero] : [])
  const [monto, setMonto] = useState(siguienteInicial ? siguienteInicial.saldo.toFixed(2) : '')
  const [medio, setMedio] = useState('EFECTIVO')
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [dialogo, setDialogo] = useState(null)
  const [resultado, setResultado] = useState(null)
  // RN-31: mismo cobro reenviado -> un solo pago (se renueva tras cada cobro).
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID())
  const solicitudCuotas = useRef(0)

  const prestamo = prestamos.find((p) => p.id === prestamoId) ?? inicial
  const cuotasPendientes = cuotas.filter((c) => c.saldo > 0)
  const seleccionado = cuotasPendientes
    .filter((c) => seleccion.includes(c.numero))
    .reduce((total, c) => total + c.saldo, 0)
  const saldoPendiente = cuotas.reduce((total, c) => total + c.saldo, 0)
  const siguienteCuota = cuotasPendientes[0]
  const transferencia = medio === 'TRANSFERENCIA'

  function aplicarCuotas(lista) {
    const sig = lista.find((c) => c.saldo > 0)
    setCuotas(lista)
    setSeleccion(sig ? [sig.numero] : [])
    setMonto(sig ? sig.saldo.toFixed(2) : '')
  }

  async function cambiarPrestamo(evento) {
    const id = evento.target.value
    const candidato = prestamos.find((p) => p.id === id)
    const solicitud = ++solicitudCuotas.current
    setError(null)
    setPrestamoId(id)
    setSeleccion([])
    setCuotas([])
    setMonto('')

    if (!candidato) return
    if (candidato.cuotas?.length) {
      aplicarCuotas(candidato.cuotas)
      return
    }

    setCargandoCuotas(true)
    const esEmpresa = candidato.prestatario?.tipo === 'EMPRESA'
    const documento = candidato.prestatario?.documento
    const busqueda = documento
      ? await buscarPrestatario(esEmpresa ? { ruc: documento } : { dni: documento })
      : { ok: false, error: { message: 'No se encontró el documento del prestatario.' } }
    if (solicitud !== solicitudCuotas.current) return
    if (!busqueda.ok) {
      setError(busqueda.error?.message ?? 'No se pudo cargar el cronograma de cuotas.')
      setCargandoCuotas(false)
      return
    }
    const historial = await obtenerHistorial(busqueda.data.prestatarioId)
    if (solicitud !== solicitudCuotas.current) return
    setCargandoCuotas(false)
    if (!historial.ok) {
      setError(historial.error?.message ?? 'No se pudo cargar el cronograma de cuotas.')
      return
    }
    const prestamoHistorial = historial.data.prestamos.find((p) => p.id === id)
    if (!prestamoHistorial?.cuotas?.length) {
      setError('Este préstamo no tiene un cronograma de cuotas disponible.')
      return
    }
    aplicarCuotas(normalizarCuotas(prestamoHistorial.cuotas))
  }

  function seleccionarCuota(numero, marcada) {
    const indice = cuotasPendientes.findIndex((c) => c.numero === numero)
    const nuevaSeleccion = marcada
      ? cuotasPendientes.slice(0, indice + 1).map((c) => c.numero)
      : cuotasPendientes.slice(0, indice).map((c) => c.numero)
    setSeleccion(nuevaSeleccion)
    const total = cuotasPendientes
      .filter((c) => nuevaSeleccion.includes(c.numero))
      .reduce((suma, c) => suma + c.saldo, 0)
    setMonto(total ? total.toFixed(2) : '')
  }

  function revisar(evento) {
    evento.preventDefault()
    const montoNum = Number(monto)
    if (!prestamoId) {
      setError('Seleccione el préstamo que se está cobrando.')
      return
    }
    if (!cuotas.length) {
      setError('Este préstamo no tiene un cronograma de cuotas disponible.')
      return
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setError('El monto debe ser mayor que cero.')
      return
    }
    if (montoNum > saldoPendiente + 0.005) {
      setError(`El monto supera el saldo pendiente del cronograma (${PEN.format(saldoPendiente)}).`)
      return
    }
    if (transferencia && !referencia.trim()) {
      setError('La transferencia requiere la referencia del abono.')
      return
    }
    setError(null)
    setPaso('confirmar')
  }

  async function confirmar() {
    setEnviando(true)
    try {
      const respuesta = await registrarPago({
        prestamoId,
        monto: Number(monto),
        medio,
        referencia: transferencia ? referencia.trim() : '',
        idempotencyKey: claveIdempotencia,
      })
      if (!respuesta.ok) {
        setDialogo({
          titulo: 'No se pudo registrar el cobro',
          mensaje: respuesta.error.message,
        })
        return
      }
      const { pago, idempotente } = respuesta.data
      setResultado({ pago, idempotente })
      setPaso('listo')
      setClaveIdempotencia(crypto.randomUUID())
      onRegistrado?.(pago)
    } finally {
      setEnviando(false)
    }
  }

  const titulo = paso === 'datos'
    ? 'Registrar cobro'
    : paso === 'confirmar'
      ? 'Confirmación del cobro'
      : 'Cobro registrado'

  return (
    <>
      <Modal
        className="flujo-modal"
        eyebrow="REGISTRO DE PAGO"
        titulo={titulo}
        subtitulo={prestamo ? `${etiquetaPrestamo(prestamo)} · ${prestamo.sucursal ?? '—'}` : undefined}
        onCerrar={onCerrar}
        bloquearCierre={enviando}
        busy={enviando || cargandoCuotas}
        acciones={(
          <>
            {paso === 'datos' && (
              <button type="button" className="btn btn-secundario" onClick={onCerrar} disabled={enviando}>
                Cancelar
              </button>
            )}
            {paso === 'datos' && (
              <button type="submit" form="form-cobro" className="btn" disabled={enviando || cargandoCuotas}>
                Revisar y confirmar
              </button>
            )}
            {paso === 'confirmar' && (
              <button type="button" className="btn btn-secundario" onClick={() => setPaso('datos')} disabled={enviando}>
                Volver a modificar
              </button>
            )}
            {paso === 'confirmar' && (
              <button type="button" className="btn" onClick={confirmar} disabled={enviando}>
                {enviando ? 'Registrando…' : 'Confirmar registro'}
              </button>
            )}
            {paso === 'listo' && (
              <button type="button" className="btn" onClick={onCerrar}>Listo</button>
            )}
          </>
        )}
      >
        <ol className="flujo-credito" aria-label="Progreso del registro de cobro">
          {PASOS.map((p, i) => {
            const actual = (paso === 'datos' && i === 0) || (paso === 'confirmar' && i === 1) || (paso === 'listo' && i === 2)
            const hecho = (paso === 'confirmar' && i === 0) || (paso === 'listo' && i < 2)
            const estado = hecho ? 'completado' : actual ? 'actual' : 'pendiente'
            return (
              <li className={`flujo-credito-paso flujo-credito-paso--${estado}`} key={p.titulo}>
                <span className="flujo-credito-indice" aria-hidden="true">{hecho ? '✓' : i + 1}</span>
                <span><strong>{p.titulo}</strong><small>{p.descripcion}</small></span>
              </li>
            )
          })}
        </ol>

        {paso === 'datos' && (
          <form id="form-cobro" className="formulario" onSubmit={revisar} noValidate>
            {!prestamoInicial && (
              <label>
                Préstamo a cobrar
                <select value={prestamoId} onChange={cambiarPrestamo} required>
                  <option value="">— Seleccione un préstamo activo —</option>
                  {prestamos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {etiquetaPrestamo(p)} · Saldo {PEN.format(p.capitalInsoluto ?? p.principal)} · {p.sucursal ?? '—'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {prestamo && (
              <>
                <p className="cargando cobranza-saldo-prestamo">
                  Capital insoluto: {PEN.format(prestamo.capitalInsoluto ?? prestamo.principal)} · Desembolsado el{' '}
                  {fecha(prestamo.desembolsadoEn)} · Estado {prestamo.estado ?? '—'}
                </p>

                <div className="cobranza-cronograma">
                  <div className="cobranza-cronograma-cabecera">
                    <div>
                      <h3>Cuotas del préstamo</h3>
                      <p>Marca una o varias cuotas pendientes para sumar el monto del pago.</p>
                    </div>
                    {seleccionado > 0 && (
                      <span className="cobranza-monto-sugerido">Seleccionado: {PEN.format(seleccionado)}</span>
                    )}
                  </div>
                  {cargandoCuotas ? (
                    <p className="cargando">Cargando el cronograma del cliente…</p>
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
                                    checked={seleccion.includes(cuota.numero)}
                                    onChange={(e) => seleccionarCuota(cuota.numero, e.target.checked)}
                                  />
                                )}
                              </td>
                              <td>{cuota.numero}</td>
                              <td>{cuota.vencimiento}</td>
                              <td>{PEN.format(cuota.montoProgramado)}</td>
                              <td>{PEN.format(cuota.montoAbonado)}</td>
                              <td><strong>{PEN.format(cuota.saldo)}</strong></td>
                              <td>
                                <span className={`cobranza-estado-cuota cobranza-estado-cuota--${cuota.estado.toLowerCase()}`}>
                                  {cuota.estado}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="cobranza-nota-cuotas">
                    {seleccion.length} cuota(s) seleccionada(s). El pago se imputa por antigüedad, por eso solo se
                    pueden seleccionar cuotas consecutivas. Puedes ajustar el monto para registrar un abono parcial.
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
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                disabled={cargandoCuotas || enviando}
                required
              />
            </label>

            <label>
              Medio
              <select value={medio} onChange={(e) => setMedio(e.target.value)} disabled={enviando}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
              </select>
            </label>

            {transferencia && (
              <label>
                Referencia del abono
                <input
                  type="text"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="CCI, operación o voucher"
                  required
                  disabled={enviando}
                />
              </label>
            )}

            {error && <div className="aviso aviso-error cobranza-aviso-formulario">{error}</div>}
            {prestamos.length === 0 && (
              <p className="cargando cobranza-aviso-formulario">No hay préstamos activos en tu sucursal para cobrar.</p>
            )}
          </form>
        )}

        {paso === 'confirmar' && prestamo && (
          <div className="cobranza-confirmacion">
            <p className="cobranza-confirmacion-nota">
              {medio === 'EFECTIVO'
                ? 'El efectivo se confirma al registrarlo y el saldo se actualiza de inmediato.'
                : 'La transferencia quedará pendiente de verificación del abono; el saldo cambia solo al confirmar (RN-23).'}
            </p>
            <dl className="datos cobranza-confirmacion-datos">
              <div><dt>Préstamo</dt><dd>{etiquetaPrestamo(prestamo)}</dd></div>
              <div><dt>Sucursal</dt><dd>{prestamo.sucursal ?? '—'}</dd></div>
              <div><dt>Cuotas incluidas</dt><dd>{seleccion.length ? seleccion.join(', ') : 'Abono a cuenta (sin selección)'}</dd></div>
              <div><dt>Monto</dt><dd>{PEN.format(Number(monto))}</dd></div>
              <div><dt>Medio</dt><dd>{medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}</dd></div>
              {transferencia && <div><dt>Referencia</dt><dd>{referencia.trim()}</dd></div>}
              <div><dt>Saldo restante</dt><dd>{PEN.format(Math.max(0, Math.round((saldoPendiente - Number(monto)) * 100) / 100))}</dd></div>
            </dl>
          </div>
        )}

        {paso === 'listo' && resultado && (
          <div className="cobranza-confirmacion">
            <p className="aviso aviso-ok">
              {resultado.idempotente
                ? 'Este cobro ya estaba registrado: no se duplicó (idempotencia).'
                : resultado.pago.estado === 'CONFIRMADO'
                  ? `Cobro de ${PEN.format(resultado.pago.monto)} registrado y confirmado.`
                  : `Cobro de ${PEN.format(resultado.pago.monto)} registrado: aguarda verificación del abono.`}
            </p>
            <p className="cargando">
              Los cobros confirmados se distribuyen entre capital e intereses en orden de vencimiento.
            </p>
          </div>
        )}
      </Modal>

      {dialogo && (
        <Dialogo
          tipo="advertencia"
          titulo={dialogo.titulo}
          mensaje={dialogo.mensaje}
          textoAceptar="Entendido"
          onAceptar={() => {
            setDialogo(null)
            setPaso('datos')
          }}
        />
      )}
    </>
  )
}
