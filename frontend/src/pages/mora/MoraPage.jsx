import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { listarMora, reprocesarMora } from '../../services/mora'

const PEN = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

function fecha(valor) {
  if (!valor) return '—'
  return new Date(`${valor}T00:00:00`).toLocaleDateString('es-PE')
}

function prestatario(prestamo) {
  const ficha = prestamo?.prestatario
  if (!ficha) return '—'
  return `${ficha.documento ?? '—'} · ${ficha.nombre ?? '—'}`
}

export default function MoraPage() {
  const { usuario } = useAuth()
  const [moras, setMoras] = useState([])
  const [expedientes, setExpedientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)

  const cargar = useCallback(async () => {
    setError(null)
    const respuesta = await listarMora()
    if (!respuesta.ok) {
      setError(respuesta.error.message)
    } else {
      setMoras(respuesta.data.moras)
      setExpedientes(respuesta.data.expedientes)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const reprocesar = async () => {
    setProcesando(true)
    setError(null)
    setMensaje(null)
    try {
      const respuesta = await reprocesarMora()
      if (!respuesta.ok) {
        setError(respuesta.error.message)
        return
      }
      const proceso = respuesta.data
      const morasNuevas = Number(proceso.moras_abiertas ?? 0)
      const morasActualizadas = Number(proceso.moras_actualizadas ?? 0)
      const morasActivasProcesadas = morasNuevas + morasActualizadas
      setMensaje(
        `Proceso ${proceso.fecha}: ${morasActivasProcesadas} moras activas (${morasNuevas} nuevas y ${morasActualizadas} actualizadas), ${proceso.moras_cerradas} cerradas y ${proceso.expedientes_creados} expedientes creados.`,
      )
      await cargar()
    } finally {
      setProcesando(false)
    }
  }

  return (
    <section>
      <h1>Mora y cobranza extrajudicial</h1>
      <p>
        Una cuota impaga entra en mora al día siguiente del vencimiento. La mora bloquea nuevas
        originaciones en todas las sucursales; no genera penalidades ni intereses adicionales.
      </p>

      {error && <div className="aviso aviso-error">{error}</div>}
      {mensaje && <div className="aviso aviso-ok">{mensaje}</div>}

      {usuario?.rol === 'ADMIN' && (
        <div className="tarjeta">
          <h2>Proceso diario</h2>
          <p className="nota">
            Se ejecuta automáticamente cada día a las 00:05 (America/Lima). Úselo solo para
            reprocesar después de una incidencia.
          </p>
          <button type="button" className="btn" onClick={reprocesar} disabled={procesando}>
            {procesando ? 'Reprocesando…' : 'Reprocesar mora'}
          </button>
        </div>
      )}

      <div className="tarjeta">
        <h2>Moras activas</h2>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : moras.length === 0 ? (
          <p>No hay cuotas vencidas con saldo en su ámbito.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Prestatario</th>
                <th>Sucursal</th>
                <th>Inicio de mora</th>
                <th>Monto vencido</th>
                <th>Cuotas vencidas</th>
              </tr>
            </thead>
            <tbody>
              {moras.map((mora) => (
                <tr key={mora.id}>
                  <td>{prestatario(mora.prestamo)}</td>
                  <td>{mora.prestamo?.sucursal ?? '—'}</td>
                  <td>{fecha(mora.inicioMora)}</td>
                  <td>{PEN.format(mora.montoVencido)}</td>
                  <td>{mora.evidencia?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="tarjeta">
        <h2>Expedientes extrajudiciales</h2>
        <p className="nota">
          El expediente conserva la traza de la racha; no elimina deuda ni ejecuta acciones de
          cobranza fuera del sistema.
        </p>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : expedientes.length === 0 ? (
          <p>Sin expedientes extrajudiciales registrados.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Prestatario</th>
                <th>Sucursal</th>
                <th>Escalado</th>
                <th>Estado</th>
                <th>Acción / resultado</th>
              </tr>
            </thead>
            <tbody>
              {expedientes.map((expediente) => (
                <tr key={expediente.id}>
                  <td>{prestatario(expediente.prestamo)}</td>
                  <td>{expediente.prestamo?.sucursal ?? '—'}</td>
                  <td>{fecha(expediente.fechaEscalamiento)}</td>
                  <td><span className="etiqueta">{expediente.estado}</span></td>
                  <td>{expediente.accion ?? expediente.resultado ?? 'Sin gestión registrada'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
