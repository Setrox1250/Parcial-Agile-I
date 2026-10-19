import { useState } from 'react'
import DniForm from '../../components/identidad/DniForm.jsx'
import ResultadoIdentidad from '../../components/identidad/ResultadoIdentidad.jsx'
import TarjetaElegibilidad from '../../components/elegibilidad/TarjetaElegibilidad.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import { consultarDni } from '../../services/dni.js'
import './identidad.css'

// HU-02 — Identidad de prestatarios naturales.
// Registro por DNI: el nombre se recupera del proveedor, sin digitación manual.
// HU-05: tras verificar identidad y cupo (HU-04), el supervisor origina el
// préstamo con vista previa de cronograma en la misma página (state local).
export default function IdentidadPrestatarioPage() {
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [originando, setOriginando] = useState(false)
  // Remonta la tarjeta de elegibilidad para refrescar el cupo tras originar.
  const [revisionElegibilidad, setRevisionElegibilidad] = useState(0)

  async function manejarConsulta(dni) {
    setConsultando(true)
    setResultado(null)
    setOriginando(false)
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

  function manejarOrigenExitoso() {
    setRevisionElegibilidad((r) => r + 1)
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

      {/* HU-04: cupo global y bloqueos tras verificar la identidad (4.5.x). */}
      {resultado?.ok && resultado.data?.prestatarioId && (
        <TarjetaElegibilidad
          key={revisionElegibilidad}
          prestatarioId={resultado.data.prestatarioId}
          onRegistrar={() => setOriginando(true)}
        />
      )}

      {/* HU-05: originación con vista previa de cronograma (5.4/5.5). */}
      {originando && resultado?.ok && resultado.data?.prestatarioId && (
        <Tarjeta titulo="Originar préstamo (TEA 30 % fija)">
          <PrestamoForm
            prestatarioId={resultado.data.prestatarioId}
            onOrigenExitoso={manejarOrigenExitoso}
          />
        </Tarjeta>
      )}
    </section>
  )
}
