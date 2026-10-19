import Tarjeta from '../ui/Tarjeta.jsx'
import Alerta from '../ui/Alerta.jsx'
import Boton from '../ui/Boton.jsx'

const MENSAJES_ERROR = {
  RUC_INVALIDO: 'El RUC debe tener 11 dígitos con dígito verificador válido.',
  RUC_NO_ENCONTRADO: 'El RUC no fue encontrado en la fuente de consulta.',
  RUC_NO_HABIDO:
    'El RUC no está ACTIVO y HABIDO. La originación queda bloqueada (CA-07).',
  DNI_INVALIDO: 'El DNI del representante debe tener 8 dígitos.',
  PROVEEDOR_ERROR: 'El servicio de consulta RUC devolvió un error. Intente nuevamente.',
  RATE_LIMIT: 'Demasiadas consultas seguidas. Espere unos segundos antes de reintentar.',
  FALLO_RED: 'No se pudo contactar al servicio de consulta RUC.',
  NO_AUTENTICADO: 'Se requiere sesión activa para consultar identidad.',
}

// Estado del vínculo con el representante/titular.
const REPRESENTANTE = {
  VINCULADO: { texto: 'Representante vinculado', badge: 'nuevo' },
  REPRESENTANTE_NO_VALIDADO: {
    texto: 'Representante sin validar: valide su DNI (HU-02) para vincularlo',
    badge: 'bloqueo',
  },
  SIN_REPRESENTANTE: {
    texto: 'Sin representante registrado: se requiere para originar (CA-08)',
    badge: 'bloqueo',
  },
  YA_REGISTRADA: { texto: 'Empresa ya registrada; se reutiliza la ficha', badge: 'existente' },
}

// Resultado de la consulta de RUC: ficha de empresa (solo lectura) o error tipificado.
export default function ResultadoEmpresa({ resultado, onNuevaConsulta }) {
  if (resultado.ok) {
    const ficha = resultado.data
    const representante = REPRESENTANTE[ficha.representanteEstado] ?? null
    return (
      <Tarjeta
        titulo="Empresa verificada"
        accion={
          <Boton type="button" variante="secundario" onClick={onNuevaConsulta}>
            Nueva consulta
          </Boton>
        }
      >
        <dl className="ficha">
          <div className="ficha-dato">
            <dt>RUC</dt>
            <dd>{ficha.numeroRuc}</dd>
          </div>
          <div className="ficha-dato">
            <dt>Razón social</dt>
            <dd>{ficha.razonSocial}</dd>
          </div>
          <div className="ficha-dato">
            <dt>Estado / condición</dt>
            <dd>
              <span className="badge badge--nuevo">{ficha.estado}</span>{' '}
              <span className="badge badge--nuevo">{ficha.condicion}</span>
            </dd>
          </div>
          <div className="ficha-dato">
            <dt>Domicilio fiscal</dt>
            <dd>
              {[ficha.direccion, ficha.distrito, ficha.provincia, ficha.departamento]
                .filter(Boolean)
                .join(' — ') || 'No informado'}
            </dd>
          </div>
          <div className="ficha-dato">
            <dt>Ficha global</dt>
            <dd>
              <span
                className={`badge badge--${
                  ficha.estadoFicha === 'EXISTENTE' ? 'existente' : 'nuevo'
                }`}
              >
                {ficha.estadoFicha}
              </span>
            </dd>
          </div>
          {(ficha.representanteDni || ficha.representanteDniSugerido) && (
            <div className="ficha-dato">
              <dt>Representante / titular</dt>
              <dd>
                DNI {ficha.representanteDni || ficha.representanteDniSugerido}
                {ficha.representanteRol ? ` — ${ficha.representanteRol}` : ' — por validar'}
              </dd>
            </div>
          )}
        </dl>

        {representante && (
          <p className="nota">
            <span className={`badge badge--${representante.badge}`}>{representante.texto}</span>
          </p>
        )}

        <Alerta tipo="info">{ficha.avisoPoderes}</Alerta>
        <p className="nota">
          El cupo y la deuda son de la empresa (RUC), nunca del DNI del representante (CA-09).
        </p>
      </Tarjeta>
    )
  }

  const { code, message, estado, condicion } = resultado.error

  return (
    <Tarjeta
      titulo="No se pudo verificar la empresa"
      accion={
        <Boton type="button" variante="secundario" onClick={onNuevaConsulta}>
          Nueva consulta
        </Boton>
      }
    >
      <Alerta tipo="error">
        {message || MENSAJES_ERROR[code] || 'No se pudo verificar la empresa.'}
      </Alerta>
      {code === 'RUC_NO_HABIDO' && (
        <div className="discrepancia">
          <p>
            <strong>Estado:</strong> {estado ?? 'desconocido'}
          </p>
          <p>
            <strong>Condición:</strong> {condicion ?? 'desconocida'}
          </p>
          <span className="badge badge--bloqueo">Bloquea originación (CA-07)</span>
        </div>
      )}
    </Tarjeta>
  )
}
