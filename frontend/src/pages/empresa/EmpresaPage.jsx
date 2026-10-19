import { useState } from 'react'
import RucForm from '../../components/empresa/RucForm.jsx'
import ResultadoEmpresa from '../../components/empresa/ResultadoEmpresa.jsx'
import AcreditarRepresentanteForm from '../../components/empresa/AcreditarRepresentanteForm.jsx'
import TarjetaElegibilidad from '../../components/elegibilidad/TarjetaElegibilidad.jsx'
import PrestamoForm from '../../components/prestamo/PrestamoForm.jsx'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import Boton from '../../components/ui/Boton.jsx'
import { consultarRuc } from '../../services/ruc.js'
import { consultarDni } from '../../services/dni.js'
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
  const [identidadRepresentante, setIdentidadRepresentante] = useState(null)
  const [consultandoIdentidadRepresentante, setConsultandoIdentidadRepresentante] = useState(false)
  const [errorRepresentante, setErrorRepresentante] = useState('')

  async function manejarConsulta(ruc) {
    setConsultando(true)
    setResultado(null)
    setPaso('empresa')
    setRepresentanteConsultado(null)
    setIdentidadRepresentante(null)
    setErrorRepresentante('')
    try {
      const respuesta = await consultarRuc(ruc)
      setResultado(respuesta)
      if (respuesta.ok) {
        let representante = null
        setConsultandoRepresentante(true)
        const consultaRepresentante = ruc.startsWith('20')
          ? await consultarRepresentanteLegal(ruc)
          : null
        if (consultaRepresentante?.ok) {
          representante = consultaRepresentante.data
          setRepresentanteConsultado(representante)
        } else if (consultaRepresentante && !consultaRepresentante.ok) {
          setErrorRepresentante(consultaRepresentante.error.message || 'No se encontró al representante legal.')
        }
        setConsultandoRepresentante(false)

        const dniRepresentante = representante?.dni
          || respuesta.data?.representanteDni
          || respuesta.data?.representanteDniSugerido
        if (dniRepresentante) {
          if (!representante) {
            representante = {
              dni: dniRepresentante,
              nombres: null,
              cargo: respuesta.data?.representanteRol,
              proveedor: 'APISPERU',
            }
            setRepresentanteConsultado(representante)
          }
          setResultado((actual) => actual?.ok
            ? {
                ...actual,
                data: {
                  ...actual.data,
                  representanteDni: dniRepresentante,
                  representanteRol: representante.cargo || actual.data.representanteRol,
                  representanteEstado: actual.data.representanteEstado === 'ACREDITADO'
                    ? 'ACREDITADO'
                    : 'VINCULADO',
                },
              }
            : actual)
          setConsultandoIdentidadRepresentante(true)
          const identidad = await consultarDni(dniRepresentante)
          if (identidad.ok) setIdentidadRepresentante(identidad.data)
          setConsultandoIdentidadRepresentante(false)
        }
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
          <ResultadoEmpresa
            resultado={resultado}
            representanteConsultado={representanteConsultado}
            identidadRepresentante={identidadRepresentante}
            consultandoRepresentante={consultandoRepresentante}
            consultandoIdentidadRepresentante={consultandoIdentidadRepresentante}
            errorRepresentante={errorRepresentante}
            onNuevaConsulta={() => { setResultado(null); setPaso('empresa') }}
          />

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
        <ResultadoEmpresa
          resultado={resultado}
          representanteConsultado={representanteConsultado}
          identidadRepresentante={identidadRepresentante}
          consultandoRepresentante={consultandoRepresentante}
          consultandoIdentidadRepresentante={consultandoIdentidadRepresentante}
          errorRepresentante={errorRepresentante}
          onNuevaConsulta={() => { setResultado(null); setPaso('empresa') }}
        />
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
