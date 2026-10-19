import { useState } from 'react'
import RucForm from '../../components/empresa/RucForm.jsx'
import ResultadoEmpresa from '../../components/empresa/ResultadoEmpresa.jsx'
import { consultarRuc } from '../../services/ruc.js'
import '../identidad/identidad.css'

// HU-03 — Identidad de empresa peruana.
// Registro por RUC: razón social, estado/condición y representante se cotejan
// con la fuente de consulta; sin representante comprobado no se origina (CA-08).
export default function EmpresaPage() {
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function manejarConsulta(ruc, representanteDni) {
    setConsultando(true)
    setResultado(null)
    try {
      const respuesta = await consultarRuc(ruc, representanteDni)
      setResultado(respuesta)
    } catch {
      setResultado({
        ok: false,
        error: { code: 'FALLO_RED', message: 'No se pudo contactar al servicio de consulta RUC.' },
      })
    } finally {
      setConsultando(false)
    }
  }

  return (
    <section className="pagina">
      <header className="pagina-cabecera">
        <h1>Identidad de empresa</h1>
        <p>
          Ingrese el RUC de 11 dígitos: la razón social, el estado y la condición se
          recuperan de la fuente de consulta, sin digitación manual. Para originar se
          requiere un representante con DNI verificado (flujo de identidad).
        </p>
      </header>

      <RucForm onConsultar={manejarConsulta} consultando={consultando} />

      {resultado && (
        <ResultadoEmpresa resultado={resultado} onNuevaConsulta={() => setResultado(null)} />
      )}
    </section>
  )
}
