import { useState } from 'react'
import RucForm from '../../components/empresa/RucForm.jsx'
import ResultadoEmpresa from '../../components/empresa/ResultadoEmpresa.jsx'
import AcreditarRepresentanteForm from '../../components/empresa/AcreditarRepresentanteForm.jsx'
import TarjetaElegibilidad from '../../components/elegibilidad/TarjetaElegibilidad.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import Alerta from '../../components/ui/Alerta.jsx'
import Boton from '../../components/ui/Boton.jsx'
import { consultarRuc } from '../../services/ruc.js'
import { consultarRepresentanteLegal } from '../../services/representanteLegal.js'
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
  const [consultandoRepresentante, setConsultandoRepresentante] = useState(false)
  const [representanteConsultado, setRepresentanteConsultado] = useState(null)
  const [errorRepresentante, setErrorRepresentante] = useState('')

  async function manejarConsulta(ruc, representanteDni) {
    setConsultando(true)
    setResultado(null)
    setOriginando(false)
    setRepresentanteConsultado(null)
    setErrorRepresentante('')
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

  async function manejarConsultaRepresentante() {
    if (!resultado?.ok) return
    setConsultandoRepresentante(true)
    setErrorRepresentante('')
    setRepresentanteConsultado(null)
    const respuesta = await consultarRepresentanteLegal(resultado.data.numeroRuc)
    if (respuesta.ok) {
      setRepresentanteConsultado(respuesta.data)
    } else {
      setErrorRepresentante(respuesta.error.message || 'No se encontró al representante legal.')
    }
    setConsultandoRepresentante(false)
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

      {resultado?.ok && resultado.data.numeroRuc.startsWith('20') && (
        <Tarjeta titulo="Representante legal (consulta opcional)">
          <p className="nota">
            Esta consulta es independiente de APISPERU y solo sugiere datos para facilitar la validación.
          </p>
          <Boton
            type="button"
            variante="secundario"
            cargando={consultandoRepresentante}
            onClick={manejarConsultaRepresentante}
          >
            {consultandoRepresentante ? 'Buscando representante…' : 'Buscar representante legal'}
          </Boton>
          {errorRepresentante && <Alerta tipo="error">{errorRepresentante}</Alerta>}
          {representanteConsultado && (
            <div className="discrepancia">
              <p><strong>Representante:</strong> {representanteConsultado.nombres || 'Nombre no informado'}</p>
              <p><strong>DNI:</strong> {representanteConsultado.dni}</p>
              {representanteConsultado.cargo && <p><strong>Cargo:</strong> {representanteConsultado.cargo}</p>}
              {representanteConsultado.fechaNombramiento && (
                <p><strong>Fecha de nombramiento:</strong> {representanteConsultado.fechaNombramiento}</p>
              )}
              {representanteConsultado.estadoCargo && <p><strong>Estado del cargo:</strong> {representanteConsultado.estadoCargo}</p>}
              <p className="nota">Dato informativo de JSON.pe. Valide el DNI y compruebe las facultades antes de acreditar la representación.</p>
            </div>
          )}
        </Tarjeta>
      )}

      {resultado?.ok &&
        resultado.data?.prestatarioId &&
        resultado.data.representanteEstado !== 'ACREDITADO' && (
        <AcreditarRepresentanteForm
          key={resultado.data.prestatarioId}
          empresaId={resultado.data.prestatarioId}
          dniSugerido={representanteConsultado?.dni ?? resultado.data.representanteDniSugerido ?? resultado.data.representanteDni}
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
