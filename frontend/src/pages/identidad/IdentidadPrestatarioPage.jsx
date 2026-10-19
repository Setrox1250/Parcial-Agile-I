import { useState } from 'react'
import DniForm from '../../components/identidad/DniForm.jsx'
import ResultadoIdentidad from '../../components/identidad/ResultadoIdentidad.jsx'
import TarjetaElegibilidad from '../../components/elegibilidad/TarjetaElegibilidad.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import Boton from '../../components/ui/Boton.jsx'
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
  const [paso, setPaso] = useState('identidad')
  // Remonta la tarjeta de elegibilidad para refrescar el cupo tras originar.
  const [revisionElegibilidad, setRevisionElegibilidad] = useState(0)

  function volverAIdentidad() {
    setResultado(null)
    setPaso('identidad')
  }

  async function manejarConsulta(dni) {
    setConsultando(true)
    setResultado(null)
    setPaso('identidad')
    try {
      const respuesta = await consultarDni(dni)
      setResultado(respuesta)
      if (respuesta.ok) setPaso('confirmacion')
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

      <FlujoCredito pasoActual={paso === 'identidad' || paso === 'confirmacion' ? 0 : paso === 'elegibilidad' ? 1 : 2} />

      {paso === 'identidad' && (
        <>
          <DniForm onConsultar={manejarConsulta} consultando={consultando} />
          {resultado && !resultado.ok && <ResultadoIdentidad resultado={resultado} onNuevaConsulta={() => setResultado(null)} />}
        </>
      )}

      {paso === 'confirmacion' && resultado?.ok && (
        <>
          <div className="flujo-pagina-acciones">
            <Boton type="button" variante="secundario" onClick={volverAIdentidad}>
              Volver a consulta
            </Boton>
          </div>
          <ResultadoIdentidad resultado={resultado} onNuevaConsulta={volverAIdentidad} />
          <Tarjeta titulo="Continuar a elegibilidad">
            <p className="nota">
              La identidad fue verificada por el proveedor. Revisa los datos de solo lectura y
              continúa para consultar el cupo global antes de originar un préstamo.
            </p>
            <div className="flujo-pagina-acciones">
              <Boton type="button" variante="secundario" onClick={volverAIdentidad}>
                Cancelar
              </Boton>
              <Boton type="button" onClick={() => setPaso('elegibilidad')}>
                Continuar a elegibilidad
              </Boton>
            </div>
          </Tarjeta>
        </>
      )}

      {paso === 'elegibilidad' && resultado?.ok && resultado.data?.prestatarioId && (
        <>
          <div className="flujo-pagina-acciones"><Boton type="button" variante="secundario" onClick={() => setPaso('identidad')}>Volver a identidad</Boton></div>
          <ResultadoIdentidad resultado={resultado} onNuevaConsulta={volverAIdentidad} />
          <TarjetaElegibilidad key={revisionElegibilidad} prestatarioId={resultado.data.prestatarioId} onRegistrar={() => setPaso('prestamo')} />
        </>
      )}

      {paso === 'prestamo' && resultado?.ok && resultado.data?.prestatarioId && (
        <>
          <div className="flujo-pagina-acciones"><Boton type="button" variante="secundario" onClick={() => setPaso('elegibilidad')}>Volver a elegibilidad</Boton></div>
          <Tarjeta titulo="Originar préstamo (TEA 30 % fija)">
            <PrestamoForm prestatarioId={resultado.data.prestatarioId} onOrigenExitoso={manejarOrigenExitoso} />
          </Tarjeta>
        </>
      )}
    </section>
  )
}
