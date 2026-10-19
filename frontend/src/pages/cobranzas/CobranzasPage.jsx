import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listarCobranza, verificarPago } from '../../services/pagos'
import RegistrarCobro from '../../components/cobranza/RegistrarCobro.jsx'
import Dialogo from '../../components/ui/Dialogo.jsx'
import { normalizarPrestamo } from '../../utils/cobranza.js'

const PEN = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

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

export default function CobranzasPage({ registro = false }) {
  const navegar = useNavigate()
  const [searchParams] = useSearchParams()
  const [prestamos, setPrestamos] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [recientes, setRecientes] = useState([])
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  // Diálogos: confirmación de acciones y mensajes pequeños (aviso/información).
  const [dialogo, setDialogo] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    setError(null)
    const respuesta = await listarCobranza()
    if (!respuesta.ok) {
      setError(respuesta.error.message)
    } else {
      setPrestamos(respuesta.data.prestamos.map(normalizarPrestamo))
      setPendientes(respuesta.data.pendientes)
      setRecientes(respuesta.data.recientes)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const verificar = (pago, accion) => {
    const confirma = accion === 'CONFIRMAR'
    setDialogo({
      tipo: 'confirmacion',
      titulo: confirma ? 'Confirmar abono' : 'Rechazar abono',
      mensaje: confirma
        ? `Se confirmará la transferencia de ${PEN.format(pago.monto)} y el saldo del préstamo se actualizará.`
        : `Se rechazará la transferencia de ${PEN.format(pago.monto)}; el pago no reducirá saldo.`,
      textoAceptar: confirma ? 'Confirmar abono' : 'Rechazar',
      textoCancelar: 'Cancelar',
      onAceptar: async () => {
        setOcupado(true)
        const respuesta = await verificarPago(pago.id, accion)
        setOcupado(false)
        if (!respuesta.ok) {
          setDialogo({
            tipo: 'advertencia',
            titulo: 'No se pudo actualizar el pago',
            mensaje: respuesta.error.message,
            onAceptar: () => setDialogo(null),
          })
          return
        }
        setDialogo({
          tipo: 'informacion',
          titulo: confirma ? 'Abono confirmado' : 'Abono rechazado',
          mensaje: confirma
            ? `Abono de ${PEN.format(pago.monto)} confirmado; el saldo ya refleja la imputación.`
            : `Abono de ${PEN.format(pago.monto)} rechazado.`,
          onAceptar: () => setDialogo(null),
        })
        await cargar()
      },
      onCancelar: () => setDialogo(null),
    })
  }

  if (registro) {
    return (
      <RegistrarCobro
        prestamos={prestamos}
        prestamoInicial={searchParams.get('prestamo') ?? undefined}
        onRegistrado={cargar}
        onCerrar={() => navegar('/cobranzas')}
      />
    )
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

      {error && <div className="aviso aviso-error">{error}</div>}

      <div className="tarjeta cobranza-abrir accion-destacada">
        <div>
          <h2>Registrar cobro</h2>
          <p className="cargando">
            El efectivo se confirma al registrarlo; la transferencia queda pendiente de verificación
            del abono (RN-23).
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => navegar('/cobranzas/registrar')}
          disabled={cargando || prestamos.length === 0}
        >
          Registrar cobro
        </button>
      </div>

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

      {dialogo && (
        <Dialogo
          tipo={dialogo.tipo}
          titulo={dialogo.titulo}
          mensaje={dialogo.mensaje}
          textoAceptar={dialogo.textoAceptar}
          textoCancelar={dialogo.textoCancelar}
          onAceptar={dialogo.onAceptar}
          onCancelar={dialogo.onCancelar ?? dialogo.onAceptar}
          ocupado={ocupado}
        />
      )}
    </section>
  )
}
