import './ui.css'

// Campo de texto reutilizable: label + input + hint/error.
// Las props adicionales (maxLength, inputMode, placeholder, onChange, ...)
// se transmiten directamente al <input>.
export default function CampoTexto({ id, etiqueta, hint, error, ...props }) {
  return (
    <div className={`campo${error ? ' campo--error' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <input id={id} aria-invalid={Boolean(error)} {...props} />
      {error ? (
        <small className="campo-mensaje campo-mensaje--error">{error}</small>
      ) : hint ? (
        <small className="campo-mensaje">{hint}</small>
      ) : null}
    </div>
  )
}
