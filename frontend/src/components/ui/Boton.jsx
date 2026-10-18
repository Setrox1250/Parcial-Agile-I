import Spinner from './Spinner.jsx'
import './ui.css'

// Botón reutilizable. Propiedades:
//   variante: 'primario' (default) | 'secundario'
//   cargando: muestra spinner y deshabilita el botón
export default function Boton({
  children,
  cargando = false,
  variante = 'primario',
  className = '',
  disabled = false,
  ...props
}) {
  return (
    <button
      {...props}
      className={`boton boton--${variante} ${className}`.trim()}
      disabled={disabled || cargando}
    >
      {cargando && <Spinner />}
      {children}
    </button>
  )
}
