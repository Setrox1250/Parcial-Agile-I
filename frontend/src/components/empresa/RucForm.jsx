import { useState } from 'react'
import CampoTexto from '../ui/CampoTexto.jsx'
import Boton from '../ui/Boton.jsx'
import { normalizarRuc, esRucValido } from '../../utils/ruc.js'

// Formulario de consulta de empresa por RUC (HU-03).
export default function RucForm({ onConsultar, consultando }) {
  const [ruc, setRuc] = useState('')
  const [error, setError] = useState('')

  const rucValido = esRucValido(ruc)

  function manejarCambioRuc(evento) {
    setRuc(normalizarRuc(evento.target.value))
    if (error) setError('')
  }

  function manejarEnvio(evento) {
    evento.preventDefault()
    if (!rucValido) {
      setError('El RUC debe tener 11 dígitos con dígito verificador válido.')
      return
    }
    onConsultar(ruc)
  }

  return (
    <form className="dni-form" onSubmit={manejarEnvio} noValidate>
      <CampoTexto
        id="ruc"
        etiqueta="RUC de la empresa"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="20123456789"
        maxLength={11}
        value={ruc}
        onChange={manejarCambioRuc}
        disabled={consultando}
        error={error && !rucValido ? error : ''}
        hint="11 dígitos numéricos; se valida el dígito verificador."
      />

      <Boton type="submit" cargando={consultando} disabled={!rucValido}>
        {consultando ? 'Consultando…' : 'Consultar RUC'}
      </Boton>
    </form>
  )
}
