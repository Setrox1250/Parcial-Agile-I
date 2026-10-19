import { useState } from 'react'
import RucForm from '../../components/empresa/RucForm.jsx'
import ResultadoEmpresa from '../../components/empresa/ResultadoEmpresa.jsx'
import AcreditarRepresentanteForm from '../../components/empresa/AcreditarRepresentanteForm.jsx'
import TarjetaElegibilidad from '../../components/elegibilidad/TarjetaElegibilidad.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import { consultarRuc } from '../../services/ruc.js'
import FlujoCredito from '../../components/operacion/FlujoCredito.jsx'
import '../identidad/identidad.css'

// HU-03 — Identidad de empresa peruana.
// Registro por RUC: razón social, estado/condición y representante se cotejan
// con la fuente de consulta; sin representante comprobado no se origina (CA-08).
export default function EmpresaPage() {
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [originando, setOriginando] = useState(false)
  const [revisionElegibilidad, setRevisionElegibilidad] = useState(0)

  async function manejarConsulta(ruc, representanteDni) {
    setConsultando(true)
    setResultado(null)
    setOriginando(false)
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

  function manejarRepresentanteAcreditado(representante) {
    setResultado((actual) => {
      if (!actual?.ok) return actual
      return {
        ...actual,
        data: {
          ...actual.data,
          representanteDni: representante.dni,
          representanteRol: 'REPRESENTANTE_LEGAL',
          representanteEstado: 'ACREDITADO',
        },
      }
    })
    setRevisionElegibilidad((revision) => revision + 1)
  }

  function manejarOrigenExitoso() {
    setRevisionElegibilidad((revision) => revision + 1)
  }

  return (
    <section className="pagina">
      <header className="pagina-cabecera">
        <p className="modulo-eyebrow">NUEVA OPERACIÓN</p>
        <h1>Originar crédito para empresa</h1>
        <p>
          Verifica el RUC y la representación legal antes de evaluar el cupo de la empresa.
        </p>
      </header>

      <FlujoCredito
        tipo="EMPRESA"
        verificado={Boolean(resultado?.ok)}
        representacionAcreditada={resultado?.data?.representanteEstado === 'ACREDITADO'}
        originando={originando}
      />

      <RucForm onConsultar={manejarConsulta} consultando={consultando} />

      {resultado && (
        <ResultadoEmpresa resultado={resultado} onNuevaConsulta={() => setResultado(null)} />
      )}

      {resultado?.ok &&
        resultado.data?.prestatarioId &&
        resultado.data.representanteEstado !== 'ACREDITADO' && (
        <AcreditarRepresentanteForm
          key={resultado.data.prestatarioId}
          empresaId={resultado.data.prestatarioId}
          dniSugerido={resultado.data.representanteDniSugerido ?? resultado.data.representanteDni}
          onAcreditado={manejarRepresentanteAcreditado}
        />
      )}

      {resultado?.ok && resultado.data?.prestatarioId && (
        <TarjetaElegibilidad
          key={revisionElegibilidad}
          prestatarioId={resultado.data.prestatarioId}
          onRegistrar={() => setOriginando(true)}
        />
      )}

      {originando && resultado?.ok && resultado.data?.prestatarioId && (
        <Tarjeta titulo="Originar préstamo empresarial (TEA 30 % fija)">
          <PrestamoForm
            prestatarioId={resultado.data.prestatarioId}
            onOrigenExitoso={manejarOrigenExitoso}
          />
        </Tarjeta>
      )}
    </section>
  )
}
