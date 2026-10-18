import { useState } from 'react'
import CampoTexto from '../ui/CampoTexto.jsx'
import Boton from '../ui/Boton.jsx'
import { normalizarDni, esDniCompleto } from '../../utils/dni.js'

// Formulario de consulta de DNI (HU-02).
// El valor se normaliza a solo dígitos (máx. 8) conservando ceros a la izquierda.
export default function DniForm({ onConsultar, consultando }) {
  const [dni, setDni] = useState('')
  const [error, setError] = useState('')

  function manejarCambio(evento) {
    setDni(normalizarDni(evento.target.value))
    if (error) setError('')
  }

  function manejarEnvio(evento) {
    evento.preventDefault()
    if (!esDniCompleto(dni)) {
      setError('El DNI debe tener exactamente 8 dígitos.')
      return
    }
    onConsultar(dni)
  }

  return (
    <form className="dni-form" onSubmit={manejarEnvio} noValidate>
      <CampoTexto
        id="dni"
        etiqueta="DNI del prestatario"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="00000000"
        maxLength={8}
        value={dni}
        onChange={manejarCambio}
        disabled={consultando}
        error={error}
        hint="8 dígitos numéricos; se conservan los ceros a la izquierda."
      />
      <Boton type="submit" cargando={consultando} disabled={!esDniCompleto(dni)}>
        {consultando ? 'Consultando…' : 'Consultar DNI'}
      </Boton>
    </form>
  )
}
