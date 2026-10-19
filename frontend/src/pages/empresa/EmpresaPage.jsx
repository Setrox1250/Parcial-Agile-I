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
  const [paso, setPaso] = useState('empresa')
  const [revisionElegibilidad, setRevisionElegibilidad] = useState(0)
  const [consultandoRepresentante, setConsultandoRepresentante] = useState(false)
  const [representanteConsultado, setRepresentanteConsultado] = useState(null)
  const [errorRepresentante, setErrorRepresentante] = useState('')

  async function manejarConsulta(ruc) {
    setConsultando(true)
    setResultado(null)
    setPaso('empresa')
    setRepresentanteConsultado(null)
    setErrorRepresentante('')
    try {
      const respuesta = await consultarRuc(ruc)
      setResultado(respuesta)
      if (respuesta.ok) {
        setPaso(respuesta.data?.representanteEstado === 'ACREDITADO' ? 'elegibilidad' : 'representacion')
      }
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
    setPaso('elegibilidad')
  }

  function manejarOrigenExitoso() {
    setRevisionElegibilidad((revision) => revision + 1)
  }

  const representanteParaAcreditar = representanteConsultado ?? (
    resultado?.ok && (resultado.data.representanteDniSugerido || resultado.data.representanteDni)
      ? {
          dni: resultado.data.representanteDniSugerido ?? resultado.data.representanteDni,
          nombres: null,
          cargo: resultado.data.representanteRol,
          proveedor: 'APISPERU',
        }
      : null
  )

  return (
    <section className="pagina">
      <header className="pagina-cabecera">
        <p className="modulo-eyebrow">NUEVA OPERACIÓN</p>
        <h1>Originar crédito para empresa</h1>
        <p>
          Verifica el RUC y la representación legal antes de evaluar el cupo de la empresa.
        </p>
      </header>

      <FlujoCredito tipo="EMPRESA" pasoActual={paso === 'empresa' ? 0 : paso === 'representacion' ? 1 : paso === 'elegibilidad' ? 2 : 3} />

      {paso === 'empresa' && (
        <>
          <RucForm onConsultar={manejarConsulta} consultando={consultando} />
          {resultado && !resultado.ok && <ResultadoEmpresa resultado={resultado} onNuevaConsulta={() => setResultado(null)} />}
        </>
      )}

      {paso === 'representacion' && resultado?.ok && (
        <>
          <div className="flujo-pagina-acciones"><Boton type="button" variante="secundario" onClick={() => setPaso('empresa')}>Volver a empresa</Boton></div>
          <ResultadoEmpresa resultado={resultado} representanteConsultado={representanteConsultado} onNuevaConsulta={() => { setResultado(null); setPaso('empresa') }} />
          {resultado.data.numeroRuc.startsWith('20') && (
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

          {resultado.data?.prestatarioId && resultado.data.representanteEstado !== 'ACREDITADO' && (
        <AcreditarRepresentanteForm
          key={`${resultado.data.prestatarioId}-${representanteParaAcreditar?.dni ?? 'sin-dni'}`}
          empresaId={resultado.data.prestatarioId}
          ruc={resultado.data.numeroRuc}
          representante={representanteParaAcreditar}
          onAcreditado={manejarRepresentanteAcreditado}
        />
          )}
        </>
      )}

      {paso === 'elegibilidad' && resultado?.ok && resultado.data?.prestatarioId && (
        <>
        <div className="flujo-pagina-acciones"><Boton type="button" variante="secundario" onClick={() => setPaso('representacion')}>Volver a representación</Boton></div>
        <ResultadoEmpresa resultado={resultado} representanteConsultado={representanteConsultado} onNuevaConsulta={() => { setResultado(null); setPaso('empresa') }} />
        <TarjetaElegibilidad
          key={revisionElegibilidad}
          prestatarioId={resultado.data.prestatarioId}
          onRegistrar={() => setPaso('prestamo')}
        />
        </>
      )}

      {paso === 'prestamo' && resultado?.ok && resultado.data?.prestatarioId && (
        <>
          <div className="flujo-pagina-acciones"><Boton type="button" variante="secundario" onClick={() => setPaso('elegibilidad')}>Volver a elegibilidad</Boton></div>
          <Tarjeta titulo="Originar préstamo empresarial (TEA 30 % fija)">
            <PrestamoForm prestatarioId={resultado.data.prestatarioId} onOrigenExitoso={manejarOrigenExitoso} />
          </Tarjeta>
        </>
      )}
    </section>
  )
}
