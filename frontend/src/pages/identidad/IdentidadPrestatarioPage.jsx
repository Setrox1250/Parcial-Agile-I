import { useState } from 'react'
import DniForm from '../../components/identidad/DniForm.jsx'
import ResultadoIdentidad from '../../components/identidad/ResultadoIdentidad.jsx'
import { consultarDni } from '../../services/dni.js'
import './identidad.css'

// HU-02 — Identidad de prestatarios naturales.
// Registro por DNI: el nombre se recupera del proveedor, sin digitación manual.
export default function IdentidadPrestatarioPage() {
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function manejarConsulta(dni) {
    setConsultando(true)
    setResultado(null)
    try {
      const respuesta = await consultarDni(dni)
      setResultado(respuesta)
    } catch {
      setResultado({
        ok: false,
        error: { code: 'FALLO_RED', message: 'No se pudo contactar al servicio de identidad.' },
      })
    } finally {
      setConsultando(false)
    }
  }

  return (
    <section className="pagina">
      <header className="pagina-cabecera">
        <h1>Identidad de prestatario</h1>
        <p>
          Ingrese el DNI de 8 dígitos: el nombre y los datos se recuperan del proveedor de
          identidad, sin digitación manual.
        </p>
      </header>

      <DniForm onConsultar={manejarConsulta} consultando={consultando} />

      {resultado && (
        <ResultadoIdentidad
          resultado={resultado}
          onNuevaConsulta={() => setResultado(null)}
        />
      )}
    </section>
  )
}
