import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Menú por rol: solo secciones realmente implementadas (1.8.1).
const MENU = {
  ADMIN: [
    { a: '/', texto: 'Inicio' },
    { a: '/identidad', texto: 'Identidad' },
    { a: '/empresa', texto: 'Empresa' },
    { a: '/desembolsos', texto: 'Desembolsos' },
    { a: '/usuarios', texto: 'Usuarios' },
  ],
  SUPERVISOR_FINANCIERO: [
    { a: '/', texto: 'Inicio' },
    { a: '/identidad', texto: 'Identidad' },
    { a: '/empresa', texto: 'Empresa' },
    { a: '/desembolsos', texto: 'Desembolsos' },
  ],
}

export default function Layout() {
  const { usuario, salir } = useAuth()
  const navigate = useNavigate()

  const cerrarSesion = async () => {
    await salir()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="marca">Préstamos Multisucursal</div>
        <nav>
          {(MENU[usuario.rol] ?? []).map((item) => (
            <NavLink key={item.a} to={item.a} end={item.a === '/'}>
              {item.texto}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="principal">
        <header className="barra-superior">
          <div className="sesion">
            <strong>{usuario.nombre_visible}</strong>
            <span className="etiqueta">{usuario.rol}</span>
            <span className="sucursal">
              {usuario.sucursal_nombre ?? 'Sin sucursal (global)'}
            </span>
          </div>
          <button type="button" className="btn btn-secundario" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </header>

        <main className="contenido">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
