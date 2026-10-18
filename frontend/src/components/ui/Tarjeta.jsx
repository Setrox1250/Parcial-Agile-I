import './ui.css'

// Contenedor de contenido destacado con título y acción opcional (ej. botón).
export default function Tarjeta({ titulo, accion, children }) {
  return (
    <section className="tarjeta">
      {(titulo || accion) && (
        <header className="tarjeta-cabecera">
          {titulo && <h2>{titulo}</h2>}
          {accion && <div className="tarjeta-accion">{accion}</div>}
        </header>
      )}
      <div className="tarjeta-cuerpo">{children}</div>
    </section>
  )
}
