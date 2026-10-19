import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Menú por rol: solo secciones realmente implementadas (1.8.1).
const MENU = {
  ADMIN: [
    { etiqueta: 'Inicio', items: [{ a: '/', texto: 'Resumen', icono: '⌂' }] },
    {
      etiqueta: 'Originación',
      items: [
        { a: '/identidad', texto: 'Nuevo crédito', icono: '+' },
        { a: '/empresa', texto: 'Empresa', icono: '▦' },
        { a: '/consulta', texto: 'Expedientes', icono: '◫' },
      ],
    },
    {
      etiqueta: 'Cartera',
      items: [
        { a: '/desembolsos', texto: 'Desembolsos', icono: '↗' },
        { a: '/cobranzas', texto: 'Cobranza', icono: '◌' },
        { a: '/mora', texto: 'Mora', icono: '!' },
      ],
    },
    {
      etiqueta: 'Control',
      items: [
        { a: '/auditoria', texto: 'Auditoría', icono: '≡' },
        { a: '/usuarios', texto: 'Usuarios', icono: '◉' },
      ],
    },
  ],
  SUPERVISOR_FINANCIERO: [
    { etiqueta: 'Inicio', items: [{ a: '/', texto: 'Resumen', icono: '⌂' }] },
    {
      etiqueta: 'Originación',
      items: [
        { a: '/identidad', texto: 'Nuevo crédito', icono: '+' },
        { a: '/empresa', texto: 'Empresa', icono: '▦' },
        { a: '/consulta', texto: 'Expedientes', icono: '◫' },
      ],
    },
    {
      etiqueta: 'Cartera',
      items: [
        { a: '/desembolsos', texto: 'Desembolsos', icono: '↗' },
        { a: '/cobranzas', texto: 'Cobranza', icono: '◌' },
        { a: '/mora', texto: 'Mora', icono: '!' },
      ],
    },
  ],
}

export default function Layout() {
  const { usuario, salir } = useAuth()
  const navigate = useNavigate()
  // Búsqueda global: abre el directorio de Consulta con el mismo filtro.
  const [busquedaGlobal, setBusquedaGlobal] = useState('')

  const cerrarSesion = async () => {
    await salir()
    navigate('/login', { replace: true })
  }

  const buscarGlobal = (evento) => {
    evento.preventDefault()
    const termino = busquedaGlobal.trim()
    if (termino) navigate(`/consulta?q=${encodeURIComponent(termino)}`)
  }

  return (
    <div className="app-shell">
        <div className="principal">
          <div className="navegacion-superior">
            <div className="marca">
              <span>Préstamos</span>
              <small>Operaciones multisucursal</small>
            </div>
            <nav className="menu-principal" aria-label="Navegación principal">
              {(MENU[usuario.rol] ?? []).map((grupo) => (
                <div className="menu-grupo" key={grupo.etiqueta}>
                  <span className="menu-grupo-etiqueta">{grupo.etiqueta}</span>
                  {grupo.items.map((item) => (
                    <NavLink key={item.a} to={item.a} end={item.a === '/'}>
                      <span aria-hidden="true" className="menu-icono">{item.icono}</span>
                      {item.texto}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
            <div className="perfil-nav">
              <div className="perfil-nav-avatar" aria-hidden="true">
                {usuario.nombre_visible?.trim()?.[0]?.toUpperCase() ?? 'U'}
              </div>
              <div className="perfil-nav-datos">
                <strong>{usuario.nombre_visible}</strong>
                <span>{usuario.rol} · {usuario.sucursal_nombre ?? 'Sin sucursal (global)'}</span>
              </div>
              <button type="button" className="perfil-nav-salir" onClick={cerrarSesion} aria-label="Cerrar sesión" title="Cerrar sesión">
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>

          <header className="barra-superior">
          <form className="buscador-global" onSubmit={buscarGlobal} noValidate>
            <input
              type="search"
              aria-label="Buscar clientes por nombre, DNI o RUC"
              autoComplete="off"
              placeholder="Buscar cliente por nombre, DNI o RUC…"
              value={busquedaGlobal}
              onChange={(e) => setBusquedaGlobal(e.target.value)}
            />
            <button type="submit" className="btn btn-secundario" disabled={!busquedaGlobal.trim()}>
              Buscar
            </button>
          </form>
          </header>

          <main className="contenido">
            <Outlet />
          </main>
        </div>
    </div>
  )
}
