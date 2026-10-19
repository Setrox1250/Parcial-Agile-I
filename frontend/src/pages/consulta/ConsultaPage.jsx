import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Tarjeta from '../../components/ui/Tarjeta.jsx'
import Alerta from '../../components/ui/Alerta.jsx'
import Boton from '../../components/ui/Boton.jsx'
import Spinner from '../../components/ui/Spinner.jsx'
import { buscarPrestatario, obtenerHistorial } from '../../services/consulta.js'
import { soles } from '../../utils/dinero.js'
import './consulta.css'

// HU-09: búsqueda global por DNI/RUC y ficha consolidada en solo lectura
// (CA-25..CA-27). Sin rutas de escritura: el historial y el expediente son
// inmutables (RN-28/RN-33).
const MOTIVOS_BLOQUEO = {
  MOROSO: 'El prestatario tiene una racha de mora abierta.',
  EXTRAJUDICIAL: 'Expediente de cobranza extrajudicial abierto (seguimiento interno).',
  BLOQUEADO_INCIDENCIA_IDENTIDAD: 'Incidencia de identidad pendiente de corrección.',
  BLOQUEADO_AUDITADO: 'Ficha con estado auditado BLOQUEADO/INACTIVO.',
}

function etiquetaEstado(estado) {
  const clase = {
    ACTIVO: 'ok',
    PAGADO: 'ok',
    PENDIENTE_DESEMBOLSO: 'info',
    ANULADO_SIN_DESEMBOLSO: 'muted',
  }[estado]
  return <span className={`consulta-badge consulta-badge--${clase ?? 'muted'}`}>{estado}</span>
}

function etiquetaCuota(estado) {
  return <span className={`consulta-badge consulta-badge--${estado === 'PAGADA' ? 'ok' : estado === 'PARCIAL' ? 'info' : 'muted'}`}>{estado}</span>
}

export default function ConsultaPage() {
  const [params, setParams] = useSearchParams()
  const [documento, setDocumento] = useState(params.get('dni') ?? params.get('ruc') ?? '')
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState(null)
  const [historial, setHistorial] = useState(null)
  const [expandido, setExpandido] = useState(null)

  const buscar = useCallback(
    async (valor) => {
      const limpio = String(valor ?? '').replace(/\D/g, '')
      if (limpio.length !== 8 && limpio.length !== 11) {
        setError({ message: 'Ingrese un DNI (8 dígitos) o un RUC (11 dígitos).' })
        setHistorial(null)
        return
      }
      setBuscando(true)
      setError(null)
      setHistorial(null)
      setExpandido(null)

      const esDni = limpio.length === 8
      const busqueda = await buscarPrestatario(esDni ? { dni: limpio } : { ruc: limpio })
      if (!busqueda.ok) {
        setError(busqueda.error)
        setBuscando(false)
        return
      }
      const histo = await obtenerHistorial(busqueda.data.prestatarioId)
      setBuscando(false)
      if (!histo.ok) {
        setError(histo.error)
        return
      }
      setHistorial(histo.data)
      setParams(esDni ? { dni: limpio } : { ruc: limpio }, { replace: true })
    },
    [setParams],
  )

  // Búsqueda inicial desde el Layout vía query params (9.3.1).
  useEffect(() => {
    const dni = params.get('dni')
    const ruc = params.get('ruc')
    if (dni || ruc) buscar(dni ?? ruc)
  }, [params, buscar])

  function manejarEnvio(evento) {
    evento.preventDefault()
    buscar(documento)
  }

  const prestatario = historial?.prestatario
  const elegibilidad = historial?.elegibilidad
  const prestamos = historial?.prestamos ?? []
  const expedientes = historial?.expedientes ?? []
  const pagosConfirmados = prestamos
    .flatMap((p) => (p.pagos ?? []).map((pg) => ({ ...pg, prestamoId: p.id })))
    .filter((pg) => pg.estado === 'CONFIRMADO')
    .sort((a, b) => String(b.confirmadoEn ?? b.registradoEn).localeCompare(String(a.confirmadoEn ?? a.registradoEn)))

  return (
    <section className="pagina consulta">
      <header className="pagina-cabecera">
        <h1>Consulta de cliente</h1>
        <p>
          Búsqueda global por DNI o RUC: identidad, cupo, préstamos, cronograma con saldos
          exactos y pagos confirmados (CA-25, solo lectura).
        </p>
      </header>

      <form className="consulta-buscador" onSubmit={manejarEnvio} noValidate>
        <div className="campo">
          <label htmlFor="documento">DNI (8) o RUC (11)</label>
          <input
            id="documento"
            inputMode="numeric"
            autoComplete="off"
            placeholder="00000000"
            maxLength={11}
            value={documento}
            onChange={(e) => setDocumento(e.target.value.replace(/\D/g, '').slice(0, 11))}
            disabled={buscando}
          />
        </div>
        <Boton type="submit" cargando={buscando} disabled={documento.length < 8}>
          {buscando ? 'Consultando…' : 'Buscar'}
        </Boton>
      </form>

      {error && <Alerta tipo="error">{error.message}</Alerta>}
      {buscando && (
        <p className="consulta-cargando">
          <Spinner /> Consolidando ficha…
        </p>
      )}

      {historial && prestatario && elegibilidad && (
        <>
          {/* 9.4.1: cabecera con identidad, clasificación y cupo. */}
          <Tarjeta titulo="Ficha consolidada">
            <div className="consulta-cabecera">
              <div>
                <h3>
                  {prestatario.identidad?.nombreCompleto ?? prestatario.identidad?.razonSocial}
                </h3>
                <p className="consulta-documento">
                  {prestatario.tipo === 'PERSONA_NATURAL' ? 'DNI' : 'RUC'}{' '}
                  {prestatario.identidad?.dni ?? prestatario.identidad?.ruc} ·{' '}
                  {prestatario.tipo === 'EMPRESA'
                    ? `RUC ${prestatario.identidad?.estadoRuc ?? '—'}`
                    : 'Persona natural'}{' '}
                  · Ficha {prestatario.estadoFicha}
                </p>
                <span className={`consulta-badge consulta-badge--${elegibilidad.clasificacion === 'NUEVO' ? 'ok' : 'info'}`}>
                  {elegibilidad.clasificacion}
                </span>
              </div>
              <dl className="consulta-cupo">
                <div>
                  <dt>Límite</dt>
                  <dd>{soles(elegibilidad.limite)}</dd>
                </div>
                <div>
                  <dt>Ocupado</dt>
                  <dd>{soles(elegibilidad.ocupado)}</dd>
                </div>
                <div className="consulta-cupo-disponible">
                  <dt>Disponible</dt>
                  <dd>{soles(elegibilidad.disponible)}</dd>
                </div>
              </dl>
            </div>
            {elegibilidad.bloqueos?.length > 0 && (
              <Alerta tipo="error">
                Bloqueos: {elegibilidad.bloqueos.map((b) => MOTIVOS_BLOQUEO[b] ?? b).join(' ')}
              </Alerta>
            )}
          </Tarjeta>

          {/* 9.4.2: tabla de préstamos expandible a cronograma y pagos. */}
          <Tarjeta titulo={`Préstamos (${prestamos.length})`}>
            {prestamos.length === 0 ? (
              <p className="consulta-vacio">Sin préstamos registrados.</p>
            ) : (
              <div className="consulta-tabla-envoltura">
                <table className="consulta-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Sucursal</th>
                      <th scope="col">Principal</th>
                      <th scope="col">Plazo</th>
                      <th scope="col">TEA</th>
                      <th scope="col">Origen</th>
                      <th scope="col">Estado</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {prestamos.map((p) => (
                      <PrestamoFila
                        key={p.id}
                        prestamo={p}
                        expandido={expandido === p.id}
                        onAlternar={() => setExpandido(expandido === p.id ? null : p.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          {/* 9.4.3: timeline de pagos confirmados. */}
          <Tarjeta titulo={`Pagos confirmados (${pagosConfirmados.length})`}>
            {pagosConfirmados.length === 0 ? (
              <p className="consulta-vacio">
                Sin pagos confirmados todavía. Los cobros se registran en Cobranza (HU-07) y la
                imputación capital/interés actualiza los saldos de las cuotas.
              </p>
            ) : (
              <ul className="consulta-timeline">
                {pagosConfirmados.map((pg) => (
                  <li key={pg.id}>
                    <span className="consulta-timeline-fecha">
                      {String(pg.confirmadoEn ?? pg.registradoEn).slice(0, 10)}
                    </span>
                    <strong>{soles(pg.monto)}</strong>
                    <span>{pg.medio}</span>
                    {pg.referencia && <span className="consulta-ref">Ref. {pg.referencia}</span>}
                    <span className="consulta-badge consulta-badge--ok">CONFIRMADO</span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          {/* 9.4.4: expediente extrajudicial inmutable, solo lectura (CA-27/RN-28). */}
          {expedientes.length > 0 && (
            <Tarjeta titulo="Expediente de cobranza extrajudicial">
              <Alerta tipo="info">
                Seguimiento interno de cobranza; no equivale a un proceso judicial. El expediente
                es inmutable y permanece en el historial aunque se regularice (RN-28).
              </Alerta>
              <ul className="consulta-expedientes">
                {expedientes.map((x) => (
                  <li key={x.id}>
                    <div>
                      <dt>Inicio de mora</dt>
                      <dd>{x.inicioMora ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Escalamiento (1 año)</dt>
                      <dd>{x.fechaEscalamiento}</dd>
                    </div>
                    <div>
                      <dt>Estado</dt>
                      <dd>{x.estado}</dd>
                    </div>
                    <div>
                      <dt>Responsable</dt>
                      <dd>{x.responsable ?? 'Sin asignar'}</dd>
                    </div>
                    {x.accion && (
                      <div>
                        <dt>Acción</dt>
                        <dd>{x.accion}</dd>
                      </div>
                    )}
                    {x.resultado && (
                      <div>
                        <dt>Resultado</dt>
                        <dd>{x.resultado}</dd>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </>
      )}
    </section>
  )
}

function PrestamoFila({ prestamo, expandido, onAlternar }) {
  const { sucursal, principal, plazoMeses, tea, fechaOriginacion, estado, desembolso } = prestamo
  return (
    <>
      <tr className="consulta-fila" onClick={onAlternar}>
        <td>{sucursal ?? '—'}</td>
        <td>{soles(principal)}</td>
        <td>{plazoMeses} m</td>
        <td>{(Number(tea) * 100).toFixed(2)} %</td>
        <td>{fechaOriginacion}</td>
        <td>{etiquetaEstado(estado)}</td>
        <td className="consulta-expandir">{expandido ? '▾' : '▸'}</td>
      </tr>
      {expandido && (
        <tr className="consulta-detalle">
          <td colSpan={7}>
            {desembolso && (
              <p className="consulta-desembolso">
                Desembolsado {soles(desembolso.importe)} · {desembolso.metodo}
                {desembolso.referencia ? ` · Ref. ${desembolso.referencia}` : ''} ·{' '}
                {String(desembolso.fecha).slice(0, 10)}
              </p>
            )}
            <table className="consulta-cronograma">
              <thead>
                <tr>
                  <th scope="col">N.º</th>
                  <th scope="col">Vencimiento</th>
                  <th scope="col">Programado</th>
                  <th scope="col">Capital abon.</th>
                  <th scope="col">Interés abon.</th>
                  <th scope="col">Saldo</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {prestamo.cuotas.map((c) => (
                  <tr key={c.numero}>
                    <td>{c.numero}</td>
                    <td>{String(c.vencimiento).slice(0, 10)}</td>
                    <td>{soles(c.totalProgramado)}</td>
                    <td>{soles(c.capitalAbonado)}</td>
                    <td>{soles(c.interesAbonado)}</td>
                    <td>{soles(c.saldo)}</td>
                    <td>{etiquetaCuota(c.estado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Pagos del préstamo ({prestamo.pagos.length})</h4>
            {prestamo.pagos.length === 0 ? (
              <p className="consulta-vacio">Sin cobros registrados.</p>
            ) : (
              <ul className="consulta-timeline">
                {prestamo.pagos.map((pg) => (
                  <li key={pg.id}>
                    <span className="consulta-timeline-fecha">
                      {String(pg.registradoEn).slice(0, 10)}
                    </span>
                    <strong>{soles(pg.monto)}</strong>
                    <span>{pg.medio}</span>
                    <span
                      className={`consulta-badge consulta-badge--${pg.estado === 'CONFIRMADO' ? 'ok' : pg.estado === 'RECHAZADO' || pg.estado === 'REVERSADO' ? 'muted' : 'info'}`}
                    >
                      {pg.estado}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
