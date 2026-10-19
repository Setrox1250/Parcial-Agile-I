import { useAuth } from '../context/AuthContext'

export default function Inicio() {
  const { usuario } = useAuth()

  return (
    <section className="inicio">
      <div className="inicio-cabecera">
        <div>
          <p className="inicio-eyebrow">PANEL DE CONTROL</p>
          <h1>Bienvenido, {usuario.nombre_visible}</h1>
          <p className="inicio-descripcion">
            Gestiona las operaciones de préstamos de tu sucursal desde un solo lugar.
          </p>
        </div>
        <div className="inicio-saludo" aria-hidden="true">{usuario.nombre_visible?.trim()?.[0]?.toUpperCase() ?? 'P'}</div>
      </div>

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
        <p>Tu acceso y sucursal se verifican de forma segura desde el sistema.</p>
      </div>
    </section>
  )
}
