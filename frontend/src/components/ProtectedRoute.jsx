import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Exige sesión activa; sin ella redirige al login (CA-01).
export function ProtectedRoute() {
  const { usuario, cargando } = useAuth()
  const location = useLocation()

  if (cargando) return <div className="cargando">Cargando sesión…</div>
  if (!usuario) return <Navigate to="/login" replace state={{ desde: location }} />
  return <Outlet />
}

// Restringe rutas a roles concretos (la validación final siempre es del backend).
export function RequireRole({ roles, children }) {
  const { usuario } = useAuth()

  if (!usuario) return <Navigate to="/login" replace />
  if (!roles.includes(usuario.rol)) {
    return (
      <div className="aviso aviso-error">
        No tiene permisos para acceder a esta sección ({usuario.rol}).
      </div>
    )
  }
  return children
}
