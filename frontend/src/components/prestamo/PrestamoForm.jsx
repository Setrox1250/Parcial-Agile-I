import { useEffect, useState } from 'react'
import CampoTexto from '../ui/CampoTexto.jsx'
import Boton from '../ui/Boton.jsx'
import Alerta from '../ui/Alerta.jsx'
import VistaCronograma from './VistaCronograma.jsx'
import { previewCronograma, originarPrestamo } from '../../services/prestamos.js'
import { supabase } from '../../services/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { hoyLocal } from '../../utils/dinero.js'
import './prestamo.css'

// Formulario de originación (HU-05 5.4): monto PEN, plazo 1..60, fecha de
// originación y TEA 30 % fija de solo lectura. ADMIN elige sucursal (RN-30).
export default function PrestamoForm({ prestatarioId, onOrigenExitoso }) {
  const { usuario } = useAuth()
  const esAdmin = usuario?.rol === 'ADMIN'

  const [monto, setMonto] = useState('')
  const [plazo, setPlazo] = useState('')
  const [fecha, setFecha] = useState(hoyLocal())
  const [sucursalId, setSucursalId] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [errores, setErrores] = useState({})
  const [preview, setPreview] = useState(null)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [cargandoConfirmacion, setCargandoConfirmacion] = useState(false)
  const [resultado, setResultado] = useState(null)

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
    setResultado(null)
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

    if (!fecha || fecha > hoyLocal()) {
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
    setResultado(null)
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
  }

  async function manejarConfirmacion() {
    setCargandoConfirmacion(true)
    const respuesta = await originarPrestamo({
      prestatarioId,
      monto: Number(monto),
      plazoMeses: Number(plazo),
      fechaOriginacion: fecha,
      sucursalId: esAdmin ? sucursalId : undefined,
      idempotencyKey: crypto.randomUUID(),
    })
    setCargandoConfirmacion(false)
    setResultado(respuesta)
    if (respuesta.ok) onOrigenExitoso?.()
  }

  return (
    <form className="prestamo-form" onSubmit={manejarPreview} noValidate>
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
        disabled={cargandoPreview || cargandoConfirmacion}
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
        disabled={cargandoPreview || cargandoConfirmacion}
        error={errores.plazo}
        hint="Entre 1 y 60 cuotas mensuales."
      />

      <CampoTexto
        id="fecha"
        etiqueta="Fecha de originación"
        type="date"
        max={hoyLocal()}
        value={fecha}
        onChange={(e) => {
          setFecha(e.target.value)
          invalidarPreview()
        }}
        disabled={cargandoPreview || cargandoConfirmacion}
        error={errores.fecha}
        hint="El primer vencimiento se calcula +1 mes calendario."
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
            disabled={cargandoPreview || cargandoConfirmacion}
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
        <Boton type="submit" cargando={cargandoPreview} disabled={cargandoConfirmacion}>
          {cargandoPreview ? 'Calculando…' : 'Ver cronograma'}
        </Boton>
      </div>

      {preview && (
        <VistaCronograma
          cuotas={preview.cuotas}
          totalAPagar={preview.totalAPagar}
          onConfirmar={manejarConfirmacion}
          cargandoConfirmacion={cargandoConfirmacion}
          resultado={resultado}
        />
      )}
    </form>
  )
}
