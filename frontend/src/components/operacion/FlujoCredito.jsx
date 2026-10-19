const PASOS_PERSONA = [
  { titulo: 'Identidad', descripcion: 'Validar DNI' },
  { titulo: 'Elegibilidad', descripcion: 'Revisar cupo' },
  { titulo: 'Oferta', descripcion: 'Simular préstamo' },
  { titulo: 'Reserva', descripcion: 'Confirmar operación' },
]

const PASOS_EMPRESA = [
  { titulo: 'Empresa', descripcion: 'Validar RUC' },
  { titulo: 'Representación', descripcion: 'Acreditar facultades' },
  { titulo: 'Elegibilidad', descripcion: 'Revisar cupo' },
  { titulo: 'Oferta', descripcion: 'Simular préstamo' },
  { titulo: 'Reserva', descripcion: 'Confirmar operación' },
]

// Componente puramente visual: refleja el punto actual del flujo sin modificar
// las validaciones ni el comportamiento de los formularios existentes.
export default function FlujoCredito({ tipo = 'PERSONA', verificado = false, representacionAcreditada = false, originando = false, pasoActual: pasoForzado }) {
  const esEmpresa = tipo === 'EMPRESA'
  const pasos = esEmpresa ? PASOS_EMPRESA : PASOS_PERSONA
  const pasoCalculado = originando
    ? pasos.length - 1
    : esEmpresa
      ? (representacionAcreditada ? 2 : verificado ? 1 : 0)
      : verificado ? 1 : 0
  const pasoActual = pasoForzado ?? pasoCalculado

  return (
    <ol className="flujo-credito" aria-label="Progreso de la originación">
      {pasos.map((paso, indice) => {
        const estado = indice < pasoActual ? 'completado' : indice === pasoActual ? 'actual' : 'pendiente'
        return (
          <li className={`flujo-credito-paso flujo-credito-paso--${estado}`} key={paso.titulo}>
            <span className="flujo-credito-indice" aria-hidden="true">{indice < pasoActual ? '✓' : indice + 1}</span>
            <span>
              <strong>{paso.titulo}</strong>
              <small>{paso.descripcion}</small>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
