import { useAuth } from '../context/AuthContext'

export default function Inicio() {
  const { usuario } = useAuth()

  return (
    <section>
      <h1>Bienvenido, {usuario.nombre_visible}</h1>
      <div className="tarjeta">
        <dl className="datos">
          <div>
            <dt>Rol</dt>
            <dd>{usuario.rol}</dd>
          </div>
          <div>
            <dt>Sucursal</dt>
            <dd>{usuario.sucursal_nombre ?? 'Sin sucursal (global)'}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{usuario.activo ? 'Activo' : 'Inactivo'}</dd>
          </div>
        </dl>
        <p className="nota">
          Los datos de rol y sucursal provienen del backend (quien-soy), no del formulario.
        </p>
      </div>
    </section>
  )
}
