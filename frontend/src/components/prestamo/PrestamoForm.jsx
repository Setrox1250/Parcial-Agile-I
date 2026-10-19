import { useEffect, useState } from 'react'
import CampoTexto from '../ui/CampoTexto.jsx'
import Boton from '../ui/Boton.jsx'
import Alerta from '../ui/Alerta.jsx'
import Dialogo from '../ui/Dialogo.jsx'
import VistaCronograma from './VistaCronograma.jsx'
import { previewCronograma, originarPrestamo } from '../../services/prestamos.js'
import { supabase } from '../../services/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { hoyLocal } from '../../utils/dinero.js'
import './prestamo.css'

const PASOS = [
  { titulo: 'Condiciones', descripcion: 'Monto, plazo y fecha' },
  { titulo: 'Cronograma', descripcion: 'Revisar y confirmar' },
]

// Formulario de originación (HU-05 5.4) en dos pasos: condiciones y
// confirmación del cronograma, con retorno al paso anterior y un único botón
// de confirmación. Monto PEN, plazo 1..60, fecha de hoy y TEA 30 % fija.
// ADMIN elige sucursal (RN-30).
export default function PrestamoForm({ prestatarioId, onOrigenExitoso }) {
  const { usuario } = useAuth()
  const esAdmin = usuario?.rol === 'ADMIN'

  const [paso, setPaso] = useState('datos')
  const [monto, setMonto] = useState('')
  const [plazo, setPlazo] = useState('')
  const [fecha, setFecha] = useState(hoyLocal())
  const [sucursalId, setSucursalId] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [errores, setErrores] = useState({})
  const [preview, setPreview] = useState(null)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [cargandoConfirmacion, setCargandoConfirmacion] = useState(false)
  const [dialogo, setDialogo] = useState(null)

  // Catálogo de sedes ACTIVAS solo para ADMIN (patrón Usuarios.jsx).
  useEffect(() => {
    if (!esAdmin) return
    let cancelado = false
    supabase
      .from('sucursales')
      .select('id, codigo, nombre')
      .eq('estado', 'ACTIVA')
      .order('nombre')
      .then(({ data }) => {
        if (!cancelado && data) setSucursales(data)
      })
    return () => {
      cancelado = true
    }
  }, [esAdmin])

  function invalidarPreview() {
    setPreview(null)
  }

  function validarCliente() {
    const nuevos = {}
    const montoNum = Number(monto)
    if (!monto || !Number.isFinite(montoNum) || montoNum <= 0) {
      nuevos.monto = 'El monto debe ser mayor a cero (sin mínimo comercial).'
    } else if (Math.round(montoNum * 100) / 100 !== montoNum) {
      nuevos.monto = 'El monto admite como máximo 2 decimales.'
    } else if (montoNum > 10000) {
      nuevos.monto = 'El monto no puede exceder S/ 10000.00 (cupo global).'
    }

    const plazoNum = Number(plazo)
    if (!plazo || !Number.isInteger(plazoNum) || plazoNum < 1 || plazoNum > 60) {
      nuevos.plazo = 'El plazo debe estar entre 1 y 60 meses.'
    }

    const hoy = hoyLocal()
    if (!fecha || fecha < hoy) {
      nuevos.fecha = 'La fecha de originación no puede ser anterior a hoy.'
    } else if (fecha > hoy) {
      nuevos.fecha = 'La fecha de originación no puede ser futura.'
    }

    if (esAdmin && !sucursalId) {
      nuevos.sucursal = 'Seleccione la sucursal de origen del préstamo.'
    }

    setErrores(nuevos)
    return Object.keys(nuevos).length === 0
  }

  async function manejarPreview(evento) {
    evento.preventDefault()
    if (!validarCliente()) return

    setCargandoPreview(true)
    const respuesta = await previewCronograma({
      monto: Number(monto),
      plazoMeses: Number(plazo),
      fechaOriginacion: fecha,
    })
    setCargandoPreview(false)
    if (!respuesta.ok) {
      setErrores({ preview: respuesta.error.message })
      return
    }
    setErrores({})
    setPreview(respuesta.data)
    setPaso('cronograma')
  }

  async function manejarConfirmacion() {
    setCargandoConfirmacion(true)
    try {
      const respuesta = await originarPrestamo({
        prestatarioId,
        monto: Number(monto),
        plazoMeses: Number(plazo),
        fechaOriginacion: fecha,
        sucursalId: esAdmin ? sucursalId : undefined,
        idempotencyKey: crypto.randomUUID(),
      })
      if (!respuesta.ok) {
        setDialogo({
          tipo: 'advertencia',
          titulo: 'No se pudo originar el préstamo',
          mensaje: respuesta.error.message,
        })
        return
      }
      const prestamo = respuesta.data?.prestamo
      setDialogo({
        tipo: 'informacion',
        titulo: 'Préstamo originado',
        mensaje: respuesta.data?.idempotente
          ? 'Este préstamo ya había sido registrado con la misma clave (idempotente).'
          : prestamo
            ? `Se originó un préstamo por ${prestamo.principal} en ${prestamo.plazoMeses} cuotas (estado ${prestamo.estado}).`
            : 'El préstamo se originó correctamente.',
      })
      onOrigenExitoso?.()
    } catch (error) {
      setDialogo({
        tipo: 'advertencia',
        titulo: 'No se pudo originar el préstamo',
        mensaje: error?.message ?? 'Ocurrió un error inesperado. Intente nuevamente.',
      })
    } finally {
      setCargandoConfirmacion(false)
    }
  }

  function reiniciar() {
    setDialogo(null)
    setMonto('')
    setPlazo('')
    setPreview(null)
    setErrores({})
    setPaso('datos')
  }

  const bloqueado = cargandoPreview || cargandoConfirmacion

  return (
    <div className="prestamo-form">
      <ol className="flujo-credito" aria-label="Progreso de la originación">
        {PASOS.map((p, i) => {
          const actual = (paso === 'datos' && i === 0) || (paso === 'cronograma' && i === 1)
          const hecho = paso === 'cronograma' && i === 0
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
        <form className="prestamo-form-paso" onSubmit={manejarPreview} noValidate>
          <CampoTexto
            id="monto"
            etiqueta="Monto solicitado (PEN)"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            max="10000"
            placeholder="0.00"
            value={monto}
            onChange={(e) => {
              setMonto(e.target.value)
              invalidarPreview()
            }}
            disabled={bloqueado}
            error={errores.monto}
            hint="Principal > 0 sin mínimo comercial; máximo S/ 10000.00 (cupo global)."
          />

          <CampoTexto
            id="plazo"
            etiqueta="Plazo (meses)"
            type="number"
            inputMode="numeric"
            min="1"
            max="60"
            placeholder="12"
            value={plazo}
            onChange={(e) => {
              setPlazo(e.target.value)
              invalidarPreview()
            }}
            disabled={bloqueado}
            error={errores.plazo}
            hint="Entre 1 y 60 cuotas mensuales."
          />

          <CampoTexto
            id="fecha"
            etiqueta="Fecha de originación"
            type="date"
            min={hoyLocal()}
            max={hoyLocal()}
            value={fecha}
            onChange={(e) => {
              setFecha(e.target.value)
              invalidarPreview()
            }}
            disabled={bloqueado}
            error={errores.fecha}
            hint="Debe ser la fecha de hoy; el primer vencimiento se calcula +1 mes calendario."
          />

          {esAdmin && (
            <div className={`campo${errores.sucursal ? ' campo--error' : ''}`}>
              <label htmlFor="sucursal">Sucursal de origen</label>
              <select
                id="sucursal"
                value={sucursalId}
                onChange={(e) => {
                  setSucursalId(e.target.value)
                  invalidarPreview()
                }}
                disabled={bloqueado}
              >
                <option value="">Seleccione una sucursal…</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} ({s.codigo})
                  </option>
                ))}
              </select>
              {errores.sucursal && (
                <small className="campo-mensaje campo-mensaje--error">{errores.sucursal}</small>
              )}
            </div>
          )}

          <div className="prestamo-tea">
            <span>Tasa de interés anual (TEA)</span>
            <strong>30.00 % — fija e inmutable</strong>
          </div>

          {errores.preview && <Alerta tipo="error">{errores.preview}</Alerta>}

          <div className="prestamo-acciones">
            <Boton type="submit" cargando={cargandoPreview}>
              {cargandoPreview ? 'Calculando…' : 'Ver cronograma'}
            </Boton>
          </div>
        </form>
      )}

      {paso === 'cronograma' && preview && (
        <VistaCronograma
          cuotas={preview.cuotas}
          totalAPagar={preview.totalAPagar}
          onConfirmar={manejarConfirmacion}
          onVolver={() => setPaso('datos')}
          cargandoConfirmacion={cargandoConfirmacion}
        />
      )}

      {dialogo && (
        <Dialogo
          tipo={dialogo.tipo}
          titulo={dialogo.titulo}
          mensaje={dialogo.mensaje}
          onAceptar={dialogo.tipo === 'informacion' ? reiniciar : () => setDialogo(null)}
          onCancelar={() => setDialogo(null)}
        />
      )}
    </div>
  )
}
