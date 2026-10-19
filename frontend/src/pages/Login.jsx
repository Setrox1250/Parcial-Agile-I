import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo-prestamos.svg'

export default function Login() {
  const { usuario, cargando, entrar } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  if (!cargando && usuario) {
    return <Navigate to={location.state?.desde?.pathname ?? '/'} replace />
  }

  const enviar = async (e) => {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      await entrar(email.trim(), password)
      navigate(location.state?.desde?.pathname ?? '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="login-pantalla">
      <aside className="login-presentacion" aria-label="Presentación de Préstamos">
        <div className="login-marca">
          <img src={logo} alt="Préstamos" />
          <span>Préstamos</span>
        </div>
        <div className="login-presentacion-contenido">
          <p className="login-eyebrow">OPERACIONES FINANCIERAS</p>
          <h1>Una operación clara en cada etapa del crédito.</h1>
          <p>Gestiona originación, desembolsos y cartera desde un entorno seguro y multisucursal.</p>
          <ul className="login-beneficios">
            <li><span aria-hidden="true">✓</span> Expedientes y cupo en un solo lugar</li>
            <li><span aria-hidden="true">✓</span> Trazabilidad en cada operación</li>
            <li><span aria-hidden="true">✓</span> Control por rol y sucursal</li>
          </ul>
        </div>
        <p className="login-pie-presentacion">Gestión financiera · Perú</p>
      </aside>

      <main className="login-panel">
        <form className="login-tarjeta" onSubmit={enviar}>
          <div className="login-marca-mobile">
            <img src={logo} alt="Préstamos" />
            <span>Préstamos</span>
          </div>
          <p className="login-eyebrow">ACCESO SEGURO</p>
          <h2>Bienvenido de nuevo</h2>
          <p className="login-subtitulo">Ingresa con las credenciales proporcionadas por tu administrador.</p>

          <div className="login-campo">
            <label htmlFor="email">Correo corporativo</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="nombre@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="login-campo">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Ingresa tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className="aviso aviso-error">{error}</div>}

          <button type="submit" className="btn login-enviar" disabled={enviando}>
            {enviando ? 'Verificando acceso…' : 'Ingresar al sistema'}
          </button>
          <p className="login-ayuda">¿Necesitas acceso? Contacta al administrador de tu sucursal.</p>
        </form>
      </main>
    </div>
  )
}
