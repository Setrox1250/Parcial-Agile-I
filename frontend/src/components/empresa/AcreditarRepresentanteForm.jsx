import { useState } from 'react'
import CampoTexto from '../ui/CampoTexto.jsx'
import Boton from '../ui/Boton.jsx'
import Alerta from '../ui/Alerta.jsx'
import { normalizarDni, esDniCompleto } from '../../utils/dni.js'
import { acreditarRepresentante } from '../../services/representantes.js'

// CA-08: la consulta de RUC no certifica poderes. Un usuario operativo debe
// asociar a una persona ya validada por DNI y registrar la evidencia revisada.
export default function AcreditarRepresentanteForm({ empresaId, dniSugerido = '', onAcreditado }) {
  const [dni, setDni] = useState(dniSugerido)
  const [fuente, setFuente] = useState('')
  const [evidencia, setEvidencia] = useState('')
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function enviar(evento) {
    evento.preventDefault()
    setResultado(null)
    if (!esDniCompleto(dni)) {
      setResultado({ ok: false, error: { message: 'El DNI debe tener 8 dígitos.' } })
      return
    }
    if (fuente.trim().length < 3 || evidencia.trim().length < 5) {
      setResultado({
        ok: false,
        error: { message: 'Indique la fuente y una referencia de evidencia de facultades.' },
      })
      return
    }

    setCargando(true)
    const respuesta = await acreditarRepresentante({
      empresaId,
      representanteDni: dni,
      fuente,
      evidenciaReferencia: evidencia,
    })
    setCargando(false)
    setResultado(respuesta)
    if (respuesta.ok) onAcreditado?.(respuesta.data)
  }

  return (
    <form className="dni-form" onSubmit={enviar} noValidate>
      <h2>Acreditar representante</h2>
      <p className="nota">
        Antes de confirmar, valide el DNI en el flujo de identidad y revise la evidencia de
        facultades. La referencia se registra para auditoría; no pegue el documento completo.
      </p>

      <CampoTexto
        id="dni-representante-acreditado"
        etiqueta="DNI del representante"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        placeholder="00000000"
        value={dni}
        onChange={(e) => setDni(normalizarDni(e.target.value))}
        disabled={cargando}
        hint="Debe corresponder a una identidad validada previamente (HU-02)."
      />
      <CampoTexto
        id="fuente-facultades"
        etiqueta="Fuente de facultades"
        autoComplete="off"
        maxLength={100}
        placeholder="Partida SUNARP, acta u otra fuente aprobada"
        value={fuente}
        onChange={(e) => setFuente(e.target.value)}
        disabled={cargando}
      />
      <CampoTexto
        id="referencia-facultades"
        etiqueta="Referencia de evidencia"
        autoComplete="off"
        maxLength={500}
        placeholder="Ej.: Partida 12345678, asiento B00001"
        value={evidencia}
        onChange={(e) => setEvidencia(e.target.value)}
        disabled={cargando}
        hint="Registre una referencia verificable, no datos personales innecesarios."
      />

      {resultado && (
        <Alerta tipo={resultado.ok ? 'ok' : 'error'}>
          {resultado.ok
            ? resultado.data.idempotente
              ? 'La representación ya estaba acreditada.'
              : 'Representación acreditada. La empresa ya puede evaluarse para originación.'
            : resultado.error.message || 'No se pudo acreditar la representación.'}
        </Alerta>
      )}

      <Boton type="submit" cargando={cargando}>
        {cargando ? 'Acreditando…' : 'Acreditar facultades'}
      </Boton>
    </form>
  )
}
