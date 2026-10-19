import { useEffect, useRef, useState } from 'react'
import './ui.css'

// Pila de modales abiertos: Escape solo cierra el más reciente y el bloqueo de
// scroll se restaura al cerrar cada nivel (ficha 360 → registro de cobro).
let modalesAbiertos = 0

// Modal genérico. className define la familia de estilos y sus piezas:
//   `${className}`           -> panel
//   `${className}-fondo`     -> fondo oscuro
//   `${className}-cabecera`  -> cabecera (span eyebrow, h2, p, botón cerrar)
//   `${className}-contenido` -> cuerpo con scroll
//   `${className}-pie`       -> pie opcional con acciones
// Props:
//   onCerrar      -> si no se pasa, el modal no se cierra con Escape ni fondo
//   bloquearCierre-> true mientras hay una operación en curso
export default function Modal({
  eyebrow,
  titulo,
  subtitulo,
  className = 'flujo-modal',
  onCerrar,
  bloquearCierre = false,
  busy = false,
  acciones,
  children,
}) {
  const dialogoRef = useRef(null)
  const [tituloId] = useState(() => `modal-titulo-${Math.random().toString(36).slice(2, 9)}`)
  const onCerrarRef = useRef(onCerrar)
  const bloquearRef = useRef(bloquearCierre)

  useEffect(() => {
    onCerrarRef.current = onCerrar
    bloquearRef.current = bloquearCierre
  })

  useEffect(() => {
    const nivel = modalesAbiertos
    modalesAbiertos += 1
    const overflowAnterior = document.body.style.overflow
    const focoAnterior = document.activeElement
    document.body.style.overflow = 'hidden'
    dialogoRef.current?.querySelector('button, input, select, textarea, a[href]')?.focus()

    function cerrarConEscape(evento) {
      if (evento.key !== 'Escape') return
      if (bloquearRef.current) return
      if (modalesAbiertos - 1 !== nivel) return
      onCerrarRef.current?.()
    }

    window.addEventListener('keydown', cerrarConEscape)
    return () => {
      window.removeEventListener('keydown', cerrarConEscape)
      modalesAbiertos -= 1
      document.body.style.overflow = overflowAnterior
      if (focoAnterior instanceof HTMLElement) focoAnterior.focus()
    }
  }, [])

  function cerrarFondo(evento) {
    if (evento.target !== evento.currentTarget) return
    if (bloquearRef.current) return
    onCerrar?.()
  }

  return (
    <div className={`${className}-fondo`} onMouseDown={cerrarFondo}>
      <section
        ref={dialogoRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-busy={busy}
      >
        <header className={`${className}-cabecera`}>
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id={tituloId}>{titulo}</h2>
            {subtitulo && <p>{subtitulo}</p>}
          </div>
          {onCerrar && (
            <button
              type="button"
              className={`${className}-cerrar`}
              aria-label="Cerrar"
              onClick={onCerrar}
              disabled={bloquearCierre}
            >
              ×
            </button>
          )}
        </header>
        <div className={`${className}-contenido`}>{children}</div>
        {acciones && <footer className={`${className}-pie`}>{acciones}</footer>}
      </section>
    </div>
  )
}
