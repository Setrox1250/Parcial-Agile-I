import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
      <form className="login-tarjeta" onSubmit={enviar}>
        <h1>Préstamos Multisucursal</h1>
        <p className="login-subtitulo">Acceso de personal autorizado</p>

        <label htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="aviso aviso-error">{error}</div>}

        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
