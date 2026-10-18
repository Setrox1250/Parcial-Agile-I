import './ui.css'

// Mensaje destacado. tipo: 'error' | 'ok' | 'info'
export default function Alerta({ tipo = 'info', children }) {
  return (
    <p className={`alerta alerta--${tipo}`} role={tipo === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  )
}
