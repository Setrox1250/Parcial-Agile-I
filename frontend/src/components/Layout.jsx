import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Menú por rol: solo secciones realmente implementadas (1.8.1).
const MENU = {
  ADMIN: [
    { a: '/', texto: 'Inicio' },
    { a: '/identidad', texto: 'Identidad' },
    { a: '/empresa', texto: 'Empresa' },
    { a: '/consulta', texto: 'Consulta' },
    { a: '/desembolsos', texto: 'Desembolsos' },
    { a: '/cobranzas', texto: 'Cobranza' },
    { a: '/mora', texto: 'Mora' },
    { a: '/auditoria', texto: 'Auditoría' },
    { a: '/usuarios', texto: 'Usuarios' },
  ],
  SUPERVISOR_FINANCIERO: [
    { a: '/', texto: 'Inicio' },
    { a: '/identidad', texto: 'Identidad' },
    { a: '/empresa', texto: 'Empresa' },
    { a: '/consulta', texto: 'Consulta' },
    { a: '/desembolsos', texto: 'Desembolsos' },
    { a: '/cobranzas', texto: 'Cobranza' },
    { a: '/mora', texto: 'Mora' },
  ],
}

export default function Layout() {
  const { usuario, salir } = useAuth()
  const navigate = useNavigate()
  // HU-09 9.3.1: buscador global DNI/RUC accesible desde el layout.
  const [documento, setDocumento] = useState('')

  const cerrarSesion = async () => {
    await salir()
    navigate('/login', { replace: true })
  }

  const buscarGlobal = (evento) => {
    evento.preventDefault()
    const limpio = documento.replace(/\D/g, '')
    if (limpio.length === 8) navigate(`/consulta?dni=${limpio}`)
    else if (limpio.length === 11) navigate(`/consulta?ruc=${limpio}`)
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
          <form className="buscador-global" onSubmit={buscarGlobal} noValidate>
            <input
              aria-label="Buscar cliente por DNI o RUC"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Buscar DNI o RUC…"
              maxLength={11}
              value={documento}
              onChange={(e) => setDocumento(e.target.value.replace(/\D/g, '').slice(0, 11))}
            />
            <button type="submit" className="btn btn-secundario" disabled={documento.length < 8}>
              Buscar
            </button>
          </form>
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
