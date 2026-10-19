import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'

export default function Inicio() {
  const { usuario } = useAuth()
  const puedeGestionarCartera = ['ADMIN', 'SUPERVISOR_FINANCIERO'].includes(usuario.rol)

  return (
    <section className="inicio">
      <div className="inicio-cabecera">
        <div>
          <p className="inicio-eyebrow">CENTRO DE OPERACIONES</p>
          <h1>Buenos días, {usuario.nombre_visible}</h1>
          <p className="inicio-descripcion">
            Prioriza tu trabajo de hoy y continúa cada operación sin perder el contexto del cliente.
          </p>
        </div>
        <div className="inicio-saludo" aria-hidden="true">{usuario.nombre_visible?.trim()?.[0]?.toUpperCase() ?? 'P'}</div>
      </div>

      <section className="inicio-acciones" aria-labelledby="inicio-acciones-titulo">
        <div className="inicio-seccion-cabecera">
          <div>
            <p className="inicio-eyebrow">ACCIONES RÁPIDAS</p>
            <h2 id="inicio-acciones-titulo">¿Qué necesitas gestionar?</h2>
          </div>
          <p>Inicia una operación o retoma un expediente existente.</p>
        </div>
        <div className="inicio-acciones-grid">
          <Link className="inicio-accion inicio-accion--primaria" to="/identidad">
            <span className="inicio-accion-icono" aria-hidden="true">+</span>
            <span><strong>Nuevo crédito</strong><small>Persona natural con DNI</small></span>
            <b aria-hidden="true">→</b>
          </Link>
          <Link className="inicio-accion" to="/empresa">
            <span className="inicio-accion-icono" aria-hidden="true">▦</span>
            <span><strong>Crédito empresa</strong><small>RUC y representación legal</small></span>
            <b aria-hidden="true">→</b>
          </Link>
          <Link className="inicio-accion" to="/consulta">
            <span className="inicio-accion-icono" aria-hidden="true">◫</span>
            <span><strong>Buscar expediente</strong><small>Cliente, crédito, pagos y cupo</small></span>
            <b aria-hidden="true">→</b>
          </Link>
          {puedeGestionarCartera && (
            <Link className="inicio-accion" to="/desembolsos">
              <span className="inicio-accion-icono" aria-hidden="true">↗</span>
              <span><strong>Operar cartera</strong><small>Desembolsos, cobros y mora</small></span>
              <b aria-hidden="true">→</b>
            </Link>
          )}
        </div>
      </section>

      <div className="inicio-resumen" aria-label="Resumen de tu cuenta">
        <article className="inicio-resumen-card">
          <span className="inicio-icono" aria-hidden="true">⌂</span>
          <div><p>Tu rol</p><strong>{usuario.rol}</strong></div>
        </article>
        <article className="inicio-resumen-card">
          <span className="inicio-icono" aria-hidden="true">⌖</span>
          <div><p>Sucursal</p><strong>{usuario.sucursal_nombre ?? 'Global'}</strong></div>
        </article>
        <article className="inicio-resumen-card">
          <span className="inicio-icono inicio-icono--estado" aria-hidden="true">✓</span>
          <div><p>Estado de cuenta</p><strong>{usuario.activo ? 'Activo' : 'Inactivo'}</strong></div>
        </article>
      </div>

      <div className="inicio-info">
        <span className="inicio-info-icono" aria-hidden="true">i</span>
        <p>Tu acceso determina el ámbito operativo de las consultas y acciones disponibles.</p>
      </div>
    </section>
  )
}
