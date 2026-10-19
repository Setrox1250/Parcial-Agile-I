import { useCallback, useEffect, useState } from 'react'
import Tarjeta from '../ui/Tarjeta.jsx'
import Alerta from '../ui/Alerta.jsx'
import Boton from '../ui/Boton.jsx'
import Spinner from '../ui/Spinner.jsx'
import { consultarElegibilidad } from '../../services/elegibilidad.js'
import './elegibilidad.css'

// Mensajes de los motivos de bloqueo que devuelve la autoridad backend (HU-04).
const MOTIVOS = {
  MOROSO: 'El prestatario tiene cuotas vencidas en mora: no puede obtener crédito nuevo en ninguna sede.',
  EXTRAJUDICIAL:
    'Expediente de cobranza extrajudicial abierto: la originación está bloqueada en toda la empresa.',
  BLOQUEADO_INCIDENCIA_IDENTIDAD:
    'Discrepancia de identidad pendiente de corrección autorizada: originación bloqueada.',
  BLOQUEADO_AUDITADO: 'La ficha del prestatario está bloqueada por decisión autorizada.',
  CUPO_INSUFICIENTE: 'La exposición global alcanza el límite de S/ 10 000.00 por prestatario.',
  MONTO_INVALIDO: 'El monto solicitado debe ser mayor que cero.',
  PRESTATARIO_NO_ENCONTRADO: 'No existe la ficha del prestatario consultado.',
}

const PEN = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

function FormatoPEN({ valor }) {
  return <>{PEN.format(Number(valor ?? 0))}</>
}

// Tarjeta de cupo global (4.5.1–4.5.4): límite, ocupado, disponible, desglose
// por préstamo con sede, motivo de bloqueo y botón de originación (HU-05).
export default function TarjetaElegibilidad({ prestatarioId, onRegistrar }) {
  const [cargando, setCargando] = useState(false)
  const [elegibilidad, setElegibilidad] = useState(null)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!prestatarioId) return
    setCargando(true)
    setError(null)
    setElegibilidad(null)
    const respuesta = await consultarElegibilidad(prestatarioId)
    if (respuesta.ok) {
      setElegibilidad(respuesta.data)
    } else {
      setError(respuesta.error)
    }
    setCargando(false)
  }, [prestatarioId])

  useEffect(() => {
    cargar()
  }, [cargar])

  if (cargando) {
    return (
      <Tarjeta titulo="Cupo global">
        <p className="elegibilidad-cargando">
          <Spinner /> Consultando exposición en todas las sedes…
        </p>
      </Tarjeta>
    )
  }

  if (error) {
    return (
      <Tarjeta titulo="Cupo global">
        <Alerta tipo="error">
          {error.message || MOTIVOS[error.code] || 'No se pudo consultar la elegibilidad.'}
        </Alerta>
      </Tarjeta>
    )
  }

  if (!elegibilidad) return null

  const { clasificacion, bloqueos, limite, ocupado, disponible, elegible, motivo, prestamos } =
    elegibilidad
  const mensajeMotivo = motivo ? MOTIVOS[motivo] ?? `Motivo: ${motivo}` : null

  return (
    <Tarjeta
      titulo="Cupo global"
      accion={
        <Boton
          type="button"
          onClick={onRegistrar}
          disabled={!elegible || typeof onRegistrar !== 'function'}
        >
          Registrar préstamo
        </Boton>
      }
    >
      <dl className="elegibilidad-cifras">
        <div className="elegibilidad-dato">
          <dt>Límite</dt>
          <dd>
            <FormatoPEN valor={limite} />
          </dd>
        </div>
        <div className="elegibilidad-dato">
          <dt>Ocupado</dt>
          <dd>
            <FormatoPEN valor={ocupado} />
          </dd>
        </div>
        <div className="elegibilidad-dato">
          <dt>Disponible</dt>
          <dd className="elegibilidad-disponible">
            <FormatoPEN valor={disponible} />
          </dd>
        </div>
        <div className="elegibilidad-dato">
          <dt>Clasificación</dt>
          <dd>
            <span className={`badge badge--${clasificacion === 'REGULAR' ? 'existente' : 'nuevo'}`}>
              {clasificacion}
            </span>
          </dd>
        </div>
      </dl>

      {!elegible && (
        <Alerta tipo="error">
          {mensajeMotivo ?? 'El prestatario no es elegible para un préstamo nuevo.'}
          {bloqueos?.length > 1 && (
            <ul className="elegibilidad-bloqueos">
              {bloqueos.map((bloqueo) => (
                <li key={bloqueo}>{MOTIVOS[bloqueo] ?? bloqueo}</li>
              ))}
            </ul>
          )}
        </Alerta>
      )}

      {prestamos?.length > 0 ? (
        <div className="elegibilidad-desglose">
          <h3>Préstamos que ocupan cupo</h3>
          <ul>
            {prestamos.map((p) => (
              <li key={p.id} className="elegibilidad-desglose-fila">
                <span className="elegibilidad-sucursal">{p.sucursal ?? 'Sede desconocida'}</span>
                <span
                  className={`badge badge--${p.estado === 'ACTIVO' ? 'existente' : 'nuevo'}`}
                >
                  {p.estado === 'PENDIENTE_DESEMBOLSO' ? 'RESERVADO' : 'ACTIVO'}
                </span>
                <span>
                  {p.estado === 'ACTIVO' ? (
                    <>
                      Capital insoluto: <FormatoPEN valor={p.capitalInsoluto} />
                    </>
                  ) : (
                    <>
                      Reserva: <FormatoPEN valor={p.reservaCapital} />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="nota">Sin préstamos activos ni reservas: cupo completo disponible.</p>
      )}
    </Tarjeta>
  )
}
