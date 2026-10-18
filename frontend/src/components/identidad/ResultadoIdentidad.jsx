import Tarjeta from '../ui/Tarjeta.jsx'
import Alerta from '../ui/Alerta.jsx'
import Boton from '../ui/Boton.jsx'

const MENSAJES_ERROR = {
  DNI_INVALIDO: 'El DNI debe tener exactamente 8 dígitos.',
  DNI_NO_ENCONTRADO: 'El DNI no fue encontrado en el registro de identidad.',
  MENOR_EDAD: 'La persona es menor de 18 años y no puede ser prestatario.',
  DISCREPANCIA_NOMBRE:
    'El nombre registrado difiere de la consulta. Se bloquea la originación hasta corrección autorizada.',
  PROVEEDOR_ERROR: 'El proveedor de identidad devolvió un error. Intente nuevamente.',
  RATE_LIMIT: 'Demasiadas consultas seguidas. Espere unos segundos antes de reintentar.',
  FALLO_RED: 'No se pudo contactar al servicio de identidad.',
  NO_AUTENTICADO: 'Se requiere sesión activa para consultar identidad.',
}

// Resultado de la consulta de DNI: ficha verificada (solo lectura) o error tipificado.
export default function ResultadoIdentidad({ resultado, onNuevaConsulta }) {
  if (resultado.ok) {
    const ficha = resultado.data
    return (
      <Tarjeta
        titulo="Identidad verificada"
        accion={
          <Boton type="button" variante="secundario" onClick={onNuevaConsulta}>
            Nueva consulta
          </Boton>
        }
      >
        <dl className="ficha">
          <div className="ficha-dato">
            <dt>DNI</dt>
            <dd>{ficha.numeroDni}</dd>
          </div>
          <div className="ficha-dato">
            <dt>Nombre completo</dt>
            <dd>{ficha.nombreCompleto}</dd>
          </div>
          <div className="ficha-dato">
            <dt>Fecha de nacimiento</dt>
            <dd>{ficha.fechaNacimiento}</dd>
          </div>
          <div className="ficha-dato">
            <dt>Edad</dt>
            <dd>{ficha.edad} años</dd>
          </div>
          <div className="ficha-dato">
            <dt>Ficha global</dt>
            <dd>
              <span className={`badge badge--${ficha.estadoFicha === 'EXISTENTE' ? 'existente' : 'nuevo'}`}>
                {ficha.estadoFicha}
              </span>
            </dd>
          </div>
        </dl>
        <p className="nota">
          El nombre proviene del proveedor de identidad y no se edita manualmente. La
          vigencia del DNI no es verificable con el proveedor actual (pendiente).
        </p>
      </Tarjeta>
    )
  }

  const { code, message, nombreRegistrado, nombreConsultado } = resultado.error

  return (
    <Tarjeta
      titulo="No se pudo verificar"
      accion={
        <Boton type="button" variante="secundario" onClick={onNuevaConsulta}>
          Nueva consulta
        </Boton>
      }
    >
      <Alerta tipo="error">{message || MENSAJES_ERROR[code] || 'No se pudo verificar la identidad.'}</Alerta>
      {code === 'DISCREPANCIA_NOMBRE' && (
        <div className="discrepancia">
          <p>
            <strong>Nombre registrado:</strong> {nombreRegistrado}
          </p>
          <p>
            <strong>Nombre consultado:</strong> {nombreConsultado}
          </p>
          <span className="badge badge--bloqueo">Bloquea originación</span>
        </div>
      )}
    </Tarjeta>
  )
}
