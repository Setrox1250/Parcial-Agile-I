import { useEffect, useRef, useState } from 'react'
import DniForm from '../../components/identidad/DniForm.jsx'
import ResultadoIdentidad from '../../components/identidad/ResultadoIdentidad.jsx'
import TarjetaElegibilidad from '../../components/elegibilidad/TarjetaElegibilidad.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import { consultarDni } from '../../services/dni.js'
import FlujoCredito from '../../components/operacion/FlujoCredito.jsx'
import './identidad.css'

// HU-02 — Identidad de prestatarios naturales.
// Registro por DNI: el nombre se recupera del proveedor, sin digitación manual.
// HU-05: tras verificar identidad y cupo (HU-04), el supervisor origina el
// préstamo con vista previa de cronograma en la misma página (state local).
export default function IdentidadPrestatarioPage() {
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [originando, setOriginando] = useState(false)
  const dialogoRef = useRef(null)
  // Remonta la tarjeta de elegibilidad para refrescar el cupo tras originar.
  const [revisionElegibilidad, setRevisionElegibilidad] = useState(0)

  useEffect(() => {
    if (!resultado) return undefined
    const overflowAnterior = document.body.style.overflow
    const focoAnterior = document.activeElement
    document.body.style.overflow = 'hidden'
    dialogoRef.current?.querySelector('button')?.focus()
    function cerrarConEscape(evento) {
      if (evento.key === 'Escape') cerrarResultado()
    }
    window.addEventListener('keydown', cerrarConEscape)
    return () => {
      window.removeEventListener('keydown', cerrarConEscape)
      document.body.style.overflow = overflowAnterior
      if (focoAnterior instanceof HTMLElement) focoAnterior.focus()
    }
  }, [resultado])

  function cerrarResultado() {
    setResultado(null)
    setOriginando(false)
  }

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
        <p className="modulo-eyebrow">NUEVA OPERACIÓN</p>
        <h1>Originar crédito para persona</h1>
        <p>
          Identifica al cliente por DNI y avanza de forma guiada hasta la reserva del crédito.
        </p>
      </header>

      <FlujoCredito verificado={Boolean(resultado?.ok)} originando={originando} />

      <DniForm onConsultar={manejarConsulta} consultando={consultando} />

      {resultado && (
        <div className="flujo-modal-fondo" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) cerrarResultado() }}>
          <section ref={dialogoRef} className="flujo-modal" role="dialog" aria-modal="true" aria-labelledby="identidad-modal-titulo">
            <header className="flujo-modal-cabecera">
              <div>
                <span>EXPEDIENTE EN ORIGINACIÓN</span>
                <h2 id="identidad-modal-titulo">{resultado.ok ? 'Continúa con la evaluación del cliente' : 'No se pudo verificar la identidad'}</h2>
              </div>
              <button type="button" className="flujo-modal-cerrar" aria-label="Cerrar resultado" onClick={cerrarResultado}>×</button>
            </header>
            <div className="flujo-modal-contenido">
              <FlujoCredito verificado={Boolean(resultado.ok)} originando={originando} />
              <ResultadoIdentidad resultado={resultado} onNuevaConsulta={cerrarResultado} />

              {/* HU-04: cupo global y bloqueos tras verificar la identidad (4.5.x). */}
              {resultado.ok && resultado.data?.prestatarioId && (
                <TarjetaElegibilidad
                  key={revisionElegibilidad}
                  prestatarioId={resultado.data.prestatarioId}
                  onRegistrar={() => setOriginando(true)}
                />
              )}

              {/* HU-05: originación con vista previa de cronograma (5.4/5.5). */}
              {originando && resultado.ok && resultado.data?.prestatarioId && (
                <Tarjeta titulo="Originar préstamo (TEA 30 % fija)">
                  <PrestamoForm
                    prestatarioId={resultado.data.prestatarioId}
                    onOrigenExitoso={manejarOrigenExitoso}
                  />
                </Tarjeta>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
