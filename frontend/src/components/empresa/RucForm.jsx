import { useState } from 'react'
import CampoTexto from '../ui/CampoTexto.jsx'
import Boton from '../ui/Boton.jsx'
import { normalizarRuc, esRucValido, esRucPersonaNatural } from '../../utils/ruc.js'
import { normalizarDni, esDniCompleto } from '../../utils/dni.js'

// Formulario de consulta de empresa por RUC (HU-03).
// El RUC 10 ya embebe el DNI del titular; para el resto puede pedirse el DNI
// del representante (que debe haberse validado antes con el flujo HU-02).
export default function RucForm({ onConsultar, consultando }) {
  const [ruc, setRuc] = useState('')
  const [representanteDni, setRepresentanteDni] = useState('')
  const [error, setError] = useState('')

  const rucValido = esRucValido(ruc)
  // En un RUC 10 el representante/titular se deriva solo; no hace falta pedirlo.
  const usaDniEmbebido = esRucPersonaNatural(ruc) && ruc.slice(0, 2) === '10'
  const dniInvalido = representanteDni.length > 0 && !esDniCompleto(representanteDni)

  function manejarCambioRuc(evento) {
    setRuc(normalizarRuc(evento.target.value))
    if (error) setError('')
  }

  function manejarCambioDni(evento) {
    setRepresentanteDni(normalizarDni(evento.target.value))
    if (error) setError('')
  }

  function manejarEnvio(evento) {
    evento.preventDefault()
    if (!rucValido) {
      setError('El RUC debe tener 11 dígitos con dígito verificador válido.')
      return
    }
    if (dniInvalido) {
      setError('El DNI del representante debe tener 8 dígitos.')
      return
    }
    onConsultar(ruc, representanteDni)
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

      <CampoTexto
        id="representanteDni"
        etiqueta="DNI del representante legal (opcional)"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="00000000"
        maxLength={8}
        value={representanteDni}
        onChange={manejarCambioDni}
        disabled={consultando || usaDniEmbebido}
        error={dniInvalido ? 'El DNI del representante debe tener 8 dígitos.' : ''}
        hint={
          usaDniEmbebido
            ? 'RUC de persona natural (10): el DNI del titular se deriva del RUC.'
            : 'Debe haberse validado antes con el flujo de identidad (HU-02).'
        }
      />

      <Boton type="submit" cargando={consultando} disabled={!rucValido || dniInvalido}>
        {consultando ? 'Consultando…' : 'Consultar RUC'}
      </Boton>
    </form>
  )
}
