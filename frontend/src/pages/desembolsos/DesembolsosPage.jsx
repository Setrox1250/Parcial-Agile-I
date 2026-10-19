import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import {
  anularDesembolso,
  confirmarDesembolso,
  editarPrestamoPendiente,
  listarDesembolsos,
} from '../../services/desembolso'

const soles = (valor) =>
  Number(valor).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fecha = (texto) => (texto ? new Date(texto).toLocaleString('es-PE') : '—')

const FORM_POR_DEFECTO = { metodo: 'EFECTIVO', referencia: '' }

// HU-06: confirmación de desembolso (CA-16) y anulación previa (CA-17).
export default function DesembolsosPage() {
  const [pendientes, setPendientes] = useState([])
  const [historial, setHistorial] = useState([])
  const [formas, setFormas] = useState({})
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [prestamoEnCurso, setPrestamoEnCurso] = useState(null)
  const [editando, setEditando] = useState(null)
  const [editandoTerminos, setEditandoTerminos] = useState(null)
  const [terminos, setTerminos] = useState({})
  // Clave idempotente por préstamo (RN-31): reintentos del mismo envío no duplican.
  const claves = useRef(new Map())

  const cargar = useCallback(async () => {
    setError(null)
    const respuesta = await listarDesembolsos()
    if (!respuesta.ok) {
      setError(respuesta.error.message)
      setCargando(false)
      return
    }
    setPendientes(respuesta.data.pendientes)
    setHistorial(respuesta.data.historial)
    setFormas(
      Object.fromEntries(respuesta.data.pendientes.map((p) => [p.id, { ...FORM_POR_DEFECTO }])),
    )
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cambiar = (prestamoId) => (e) =>
    setFormas((actual) => ({
      ...actual,
      [prestamoId]: { ...actual[prestamoId], [e.target.name]: e.target.value },
    }))

  const cambiarTermino = (prestamoId) => (e) =>
    setTerminos((actual) => ({ ...actual, [prestamoId]: { ...actual[prestamoId], [e.target.name]: e.target.value } }))

  const iniciarEdicionTerminos = (prestamo) => {
    setEditandoTerminos(prestamo.id)
    setTerminos((actual) => ({
      ...actual,
      [prestamo.id]: { monto: String(prestamo.principal), plazoMeses: String(prestamo.plazoMeses) },
    }))
    setError(null)
    setMensaje(null)
  }

  const guardarTerminos = async (prestamo) => {
    const formulario = terminos[prestamo.id]
    setError(null)
    setMensaje(null)
    setPrestamoEnCurso(prestamo.id)
    try {
      const monto = Number(formulario?.monto)
      const plazoMeses = Number(formulario?.plazoMeses)
      const resultado = await editarPrestamoPendiente(prestamo.id, { monto, plazoMeses })
      if (!resultado.ok) { setError(resultado.error.message); return }
      setEditandoTerminos(null)
      const interesTotal = resultado.data.prestamo.interesTotal
      setMensaje(interesTotal == null
        ? 'Préstamo actualizado. Recarga la lista para consultar el interés total del cronograma.'
        : `Préstamo actualizado. Interés total: S/ ${soles(interesTotal)}.`)
      await cargar()
    } finally {
      setPrestamoEnCurso(null)
    }
  }

  const editar = (prestamoId) => {
    setEditando(prestamoId)
    setError(null)
    setMensaje(null)
  }

  const confirmar = async (prestamo) => {
    const form = formas[prestamo.id] ?? FORM_POR_DEFECTO
    setError(null)
    setMensaje(null)
    setPrestamoEnCurso(prestamo.id)
    try {
      if (!claves.current.has(prestamo.id)) {
        claves.current.set(prestamo.id, crypto.randomUUID())
      }
      const respuesta = await confirmarDesembolso(prestamo.id, {
        metodo: form.metodo,
        referencia: form.referencia,
        idempotencyKey: claves.current.get(prestamo.id),
      })
      if (!respuesta.ok) {
        setError(respuesta.error.message)
        return
      }
      setMensaje(
        `Desembolso de S/ ${soles(prestamo.principal)} confirmado (préstamo ${prestamo.id.slice(0, 8)}).`,
      )
      claves.current.delete(prestamo.id)
      setEditando(null)
      await cargar()
    } finally {
      setPrestamoEnCurso(null)
    }
  }

  const anular = async (prestamo) => {
    const seguro = window.confirm(
      `¿Anular el préstamo de S/ ${soles(prestamo.principal)}? Se liberará la reserva de cupo.`,
    )
    if (!seguro) return
    setError(null)
    setMensaje(null)
    setPrestamoEnCurso(prestamo.id)
    try {
      const respuesta = await anularDesembolso(prestamo.id)
      if (!respuesta.ok) {
        setError(respuesta.error.message)
        return
      }
      setMensaje(`Préstamo anulado; cupo liberado: S/ ${soles(respuesta.data.cupoLiberado)}.`)
      await cargar()
    } finally {
      setPrestamoEnCurso(null)
    }
  }

  return (
    <section className="modulo-operativo">
      <header className="modulo-cabecera">
        <div>
          <p className="modulo-eyebrow">OPERACIÓN DE CARTERA</p>
          <h1>Desembolsos</h1>
          <p>Confirma la entrega para activar el préstamo o libera una reserva que no continuará.</p>
        </div>
        <span className="modulo-contador">{pendientes.length} por resolver</span>
      </header>

      {error && <div className="aviso aviso-error">{error}</div>}
      {mensaje && <div className="aviso aviso-ok">{mensaje}</div>}

      <div className="tarjeta cola-operativa">
        <div className="cola-operativa-cabecera">
          <div><p className="tarjeta-eyebrow">COLA DE TRABAJO</p><h2>Pendientes de desembolso</h2></div>
          <span>Activa o anula cada reserva</span>
        </div>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : pendientes.length === 0 ? (
          <p>No hay préstamos pendientes de desembolso en su ámbito.</p>
        ) : (
          <div className="tabla-envoltura"><table className="tabla">
            <thead>
              <tr>
                <th>Prestatario</th>
                <th>Principal</th>
                <th>Plazo</th>
                <th>Interés total</th>
                <th>Sucursal origen</th>
                <th>Registrado</th>
                <th>Método</th>
                <th>Referencia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => {
                const form = formas[p.id] ?? FORM_POR_DEFECTO
                const ocupado = prestamoEnCurso === p.id
                const enEdicion = editando === p.id
                const editandoDatos = editandoTerminos === p.id
                return (
                  <Fragment key={p.id}>
                  <tr key={p.id}>
                    <td>
                      <strong>{p.prestatario?.nombre ?? '—'}</strong>
                      <br />
                      {p.prestatario?.tipo === 'EMPRESA' ? 'RUC' : 'DNI'}{' '}
                      {p.prestatario?.documento ?? '—'}
                    </td>
                    <td>S/ {soles(p.principal)}</td>
                    <td>{p.plazoMeses} m</td>
                    <td>{p.interesTotal == null ? 'Cronograma no disponible' : <>S/ {soles(p.interesTotal)} <small>(TEA 30 %)</small></>}</td>
                    <td>{p.sucursal ?? '—'}</td>
                    <td>{fecha(p.creadoEn)}</td>
                    <td>
                      <select
                        name="metodo"
                        value={form.metodo}
                        onChange={cambiar(p.id)}
                        disabled={ocupado || !enEdicion}
                      >
                        <option value="EFECTIVO">Efectivo</option>
                        <option value="TRANSFERENCIA">Transferencia</option>
                      </select>
                    </td>
                    <td>
                      {form.metodo === 'TRANSFERENCIA' ? (
                        <input
                          type="text"
                          name="referencia"
                          value={form.referencia}
                          onChange={cambiar(p.id)}
                          placeholder="N.º de operación"
                          disabled={ocupado || !enEdicion}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {enEdicion ? (
                        <button
                          type="button"
                          className="btn btn-secundario"
                          onClick={() => setEditando(null)}
                          disabled={ocupado}
                        >
                          Listo
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secundario"
                          onClick={() => editar(p.id)}
                          disabled={ocupado}
                        >
                          Editar entrega
                        </button>
                      )}{' '}
                      <button
                        type="button"
                        className="btn btn-secundario"
                        onClick={() => iniciarEdicionTerminos(p)}
                          disabled={ocupado || editandoDatos}
                      >
                        Editar préstamo
                      </button>{' '}
                      <button
                        type="button"
                        className="btn"
                        onClick={() => confirmar(p)}
                        disabled={ocupado || editandoDatos || (form.metodo === 'TRANSFERENCIA' && !form.referencia.trim())}
                      >
                        {ocupado ? 'Procesando…' : 'Confirmar desembolso'}
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-secundario"
                        onClick={() => anular(p)}
                        disabled={ocupado || editandoDatos}
                      >
                        Anular
                      </button>
                    </td>
                  </tr>
                  {editandoTerminos === p.id && (
                    <tr key={`${p.id}-edicion`}>
                      <td colSpan={9}>
                        <div className="desembolso-editar-terminos">
                          <strong>Editar términos antes de desembolsar</strong>
                          <label>Monto (S/)<input type="number" min="0.01" step="0.01" name="monto" value={terminos[p.id]?.monto ?? ''} onChange={cambiarTermino(p.id)} /></label>
                          <label>Plazo (meses)<input type="number" min="1" max="60" step="1" name="plazoMeses" value={terminos[p.id]?.plazoMeses ?? ''} onChange={cambiarTermino(p.id)} /></label>
                          <span>TEA fija: 30 %. Se recalcularán cuotas e interés total.</span>
                          <button type="button" className="btn" onClick={() => guardarTerminos(p)} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar cambios'}</button>
                          <button type="button" className="btn btn-secundario" onClick={() => setEditandoTerminos(null)} disabled={ocupado}>Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="tarjeta cola-operativa">
        <div className="cola-operativa-cabecera">
          <div><p className="tarjeta-eyebrow">HISTORIAL</p><h2>Evidencia de desembolsos confirmados</h2></div>
          <span>Últimas operaciones de tu ámbito</span>
        </div>
        {historial.length === 0 ? (
          <p>Sin desembolsos confirmados todavía.</p>
        ) : (
          <div className="tabla-envoltura"><table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Importe</th>
                <th>Método</th>
                <th>Referencia</th>
                <th>Sucursal</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((d) => (
                <tr key={d.id}>
                  <td>{fecha(d.fecha)}</td>
                  <td>S/ {soles(d.importe)}</td>
                  <td>{d.metodo}</td>
                  <td>{d.referencia ?? '—'}</td>
                  <td>{d.sucursal ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </section>
  )
}
