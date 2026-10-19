import Modal from './Modal.jsx'
import './ui.css'

// Diálogo pequeño para confirmaciones, advertencias e información breve.
//   tipo: 'confirmacion' (Aceptar + Cancelar)
//         'advertencia'  (solo Aceptar, acento ámbar)
//         'informacion'  (solo Aceptar, acento teal)
export default function Dialogo({
  tipo = 'informacion',
  titulo,
  mensaje,
  textoAceptar = 'Aceptar',
  textoCancelar = 'Cancelar',
  onAceptar,
  onCancelar,
  ocupado = false,
}) {
  const simbolo = tipo === 'confirmacion' ? '?' : tipo === 'advertencia' ? '!' : 'i'

  return (
    <Modal
      className="dialogo-modal"
      eyebrow={tipo === 'confirmacion' ? 'CONFIRMACIÓN' : tipo === 'advertencia' ? 'ADVERTENCIA' : 'INFORMACIÓN'}
      titulo={titulo}
      onCerrar={ocupado ? undefined : onCancelar ?? onAceptar}
      bloquearCierre={ocupado}
      busy={ocupado}
      acciones={(
        <>
          {tipo === 'confirmacion' && (
            <button
              type="button"
              className="btn btn-secundario"
              onClick={onCancelar}
              disabled={ocupado}
            >
              {textoCancelar}
            </button>
          )}
          <button type="button" className="btn" onClick={onAceptar} disabled={ocupado}>
            {ocupado ? 'Procesando…' : textoAceptar}
          </button>
        </>
      )}
    >
      <p className={`dialogo-mensaje dialogo-mensaje--${tipo}`}>
        <span className={`dialogo-simbolo dialogo-simbolo--${tipo}`} aria-hidden="true">{simbolo}</span>
        <span>{mensaje}</span>
      </p>
    </Modal>
  )
}
