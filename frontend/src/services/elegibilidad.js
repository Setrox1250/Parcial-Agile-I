import { llamarFuncion } from './supabase.js'

// Consulta de elegibilidad y cupo global (HU-04).
//
// Contrato:
//   consultarElegibilidad(prestatarioId) →
//     { ok: true,  data: { existe, clasificacion, bloqueos, limite, ocupado,
//                          disponible, monto_solicitado, elegible, motivo,
//                          prestamos: [{ id, estado, sucursal, capitalInsoluto,
//                                        reservaCapital, creadoEn }] } }
//     { ok: false, error: { code, message } }

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

export async function consultarElegibilidad(prestatarioId) {
  if (!prestatarioId) {
    return fallo('PRESTATARIO_REQUERIDO', 'Falta el identificador de la ficha del prestatario.')
  }

  try {
    const cuerpo = await llamarFuncion('elegibilidad', { path: `/${prestatarioId}` })
    if (cuerpo?.elegibilidad) return { ok: true, data: cuerpo.elegibilidad }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de elegibilidad.')
  } catch (error) {
    if (typeof error?.payload?.code === 'string') {
      return { ok: false, error: error.payload }
    }
    if (error?.status === 401 || error?.status === 403) {
      return fallo('NO_AUTENTICADO', 'Se requiere sesión activa para consultar el cupo.')
    }
    if (error?.status === 404) {
      return fallo('PRESTATARIO_NO_ENCONTRADO', 'No existe la ficha del prestatario consultado.')
    }
    return fallo('FALLO_RED', 'No se pudo contactar al servicio de elegibilidad.')
  }
}
