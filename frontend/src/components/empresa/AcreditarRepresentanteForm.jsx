import { useState } from 'react'
import Boton from '../ui/Boton.jsx'
import Alerta from '../ui/Alerta.jsx'
import { consultarDni } from '../../services/dni.js'
import { acreditarRepresentante } from '../../services/representantes.js'

// Valida el DNI sugerido y registra la evidencia del proceso sin pedir que
// el usuario vuelva a escribir datos que ya llegaron de la consulta del RUC.
export default function AcreditarRepresentanteForm({ empresaId, ruc, representante, onAcreditado }) {
  const [confirmoFacultades, setConfirmoFacultades] = useState(false)
  const [consultandoDni, setConsultandoDni] = useState(false)
  const [acreditando, setAcreditando] = useState(false)
  const [identidad, setIdentidad] = useState(null)
  const [resultado, setResultado] = useState(null)

  async function consultarIdentidad() {
    setResultado(null)
    setConsultandoDni(true)
    const validacion = await consultarDni(representante.dni)
    setConsultandoDni(false)
    if (!validacion.ok) {
      setIdentidad(null)
      setResultado({ ok: false, error: validacion.error })
      return
    }
    setIdentidad(validacion.data)
  }

  async function acreditar() {
    setResultado(null)
    if (!identidad) {
      setResultado({
        ok: false,
        error: { message: 'Consulte y verifique los datos del DNI antes de acreditar la representación.' },
      })
      return
    }
    if (!confirmoFacultades) {
      setResultado({
        ok: false,
        error: { message: 'Confirme que revisó las facultades del representante en una fuente autorizada.' },
      })
      return
    }

    setAcreditando(true)
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
    setAcreditando(false)
    setResultado(acreditacion)
    if (acreditacion.ok) {
      onAcreditado?.({ ...acreditacion.data, nombreValidado: identidad.nombreCompleto })
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
        Consulte los datos de identidad con HU-02 y revise las facultades en una fuente autorizada
        antes de acreditar la representación.
      </p>

      {!identidad && (
        <Boton type="button" cargando={consultandoDni} onClick={consultarIdentidad}>
          {consultandoDni ? 'Consultando DNI…' : 'Consultar datos del DNI'}
        </Boton>
      )}

      {identidad && (
        <>
          <dl className="ficha">
            <div className="ficha-dato">
              <dt>DNI</dt>
              <dd>{identidad.numeroDni}</dd>
            </div>
            <div className="ficha-dato">
              <dt>Nombre completo</dt>
              <dd>{identidad.nombreCompleto}</dd>
            </div>
            <div className="ficha-dato">
              <dt>Fecha de nacimiento</dt>
              <dd>{identidad.fechaNacimiento || 'No informada'}</dd>
            </div>
            <div className="ficha-dato">
              <dt>Edad</dt>
              <dd>{identidad.edad ?? 'No informada'}</dd>
            </div>
            <div className="ficha-dato">
              <dt>Ficha de identidad</dt>
              <dd>
                <span className={`badge badge--${identidad.estadoFicha === 'EXISTENTE' ? 'existente' : 'nuevo'}`}>
                  {identidad.estadoFicha}
                </span>
              </dd>
            </div>
          </dl>

          <Boton type="button" variante="secundario" onClick={consultarIdentidad} disabled={acreditando}>
            Actualizar datos del DNI
          </Boton>

          <label className="nota" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
            <input
              type="checkbox"
              checked={confirmoFacultades}
              onChange={(evento) => setConfirmoFacultades(evento.target.checked)}
              disabled={acreditando}
            />
            Confirmo que revisé las facultades de representación para esta operación.
          </label>

          <Boton type="button" cargando={acreditando} disabled={!confirmoFacultades} onClick={acreditar}>
            {acreditando ? 'Acreditando representante…' : 'Acreditar representante'}
          </Boton>
        </>
      )}

      {resultado && (
        <Alerta tipo={resultado.ok ? 'ok' : 'error'}>
          {resultado.ok
            ? resultado.data.idempotente
              ? 'La representación ya estaba acreditada.'
              : `DNI validado${resultado.data.nombreValidado ? `: ${resultado.data.nombreValidado}` : ''}. Representación acreditada.`
            : resultado.error.message || 'No se pudo acreditar la representación.'}
        </Alerta>
      )}

    </section>
  )
}
