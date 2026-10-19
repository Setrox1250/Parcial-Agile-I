import { useState } from 'react'
import Boton from '../ui/Boton.jsx'
import Alerta from '../ui/Alerta.jsx'
import { consultarDni } from '../../services/dni.js'
import { acreditarRepresentante } from '../../services/representantes.js'

// Valida el DNI sugerido y registra la evidencia del proceso sin pedir que
// el usuario vuelva a escribir datos que ya llegaron de la consulta del RUC.
export default function AcreditarRepresentanteForm({ empresaId, ruc, representante, onAcreditado }) {
  const [confirmoFacultades, setConfirmoFacultades] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function acreditar(evento) {
    evento.preventDefault()
    setResultado(null)
    if (!confirmoFacultades) {
      setResultado({
        ok: false,
        error: { message: 'Confirme que revisó las facultades del representante en una fuente autorizada.' },
      })
      return
    }

    setCargando(true)
    const validacion = await consultarDni(representante.dni)
    if (!validacion.ok) {
      setCargando(false)
      setResultado({ ok: false, error: validacion.error })
      return
    }

    const fechaRevision = new Date().toISOString()
    const fuente = `${representante.proveedor || 'Consulta de identidad'} - representante legal`
    const evidenciaReferencia = [
      `RUC ${ruc}`,
      `DNI ${representante.dni} validado mediante HU-02`,
      representante.cargo ? `cargo ${representante.cargo}` : null,
      representante.fechaNombramiento ? `nombramiento ${representante.fechaNombramiento}` : null,
      `facultades revisadas por el operador; fecha ${fechaRevision}`,
    ].filter(Boolean).join('; ')

    const acreditacion = await acreditarRepresentante({
      empresaId,
      representanteDni: representante.dni,
      fuente,
      evidenciaReferencia,
    })
    setCargando(false)
    setResultado(acreditacion)
    if (acreditacion.ok) {
      onAcreditado?.({ ...acreditacion.data, nombreValidado: validacion.data.nombreCompleto })
    }
  }

  if (!representante?.dni) return null

  return (
    <section className="dni-form">
      <h2>Acreditar representante</h2>
      <p className="nota">
        {representante.nombres || 'Representante legal'} · DNI {representante.dni}
        {representante.cargo ? ` · ${representante.cargo}` : ''}
      </p>
      <p className="nota">
        Al confirmar, el sistema valida automáticamente el DNI con HU-02 y registra la consulta.
        Revise las facultades en una fuente autorizada antes de continuar.
      </p>

      <label className="nota" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
        <input
          type="checkbox"
          checked={confirmoFacultades}
          onChange={(evento) => setConfirmoFacultades(evento.target.checked)}
          disabled={cargando}
        />
        Confirmo que revisé las facultades de representación para esta operación.
      </label>

      {resultado && (
        <Alerta tipo={resultado.ok ? 'ok' : 'error'}>
          {resultado.ok
            ? resultado.data.idempotente
              ? 'La representación ya estaba acreditada.'
              : `DNI validado${resultado.data.nombreValidado ? `: ${resultado.data.nombreValidado}` : ''}. Representación acreditada.`
            : resultado.error.message || 'No se pudo acreditar la representación.'}
        </Alerta>
      )}

      <Boton type="button" cargando={cargando} disabled={!confirmoFacultades} onClick={acreditar}>
        {cargando ? 'Validando y acreditando…' : 'Validar DNI y acreditar representante'}
      </Boton>
    </section>
  )
}
