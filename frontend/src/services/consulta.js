import { llamarFuncion } from './supabase.js'

// Consultas globales e historial consolidado (HU-09).
//
// Contrato:
//   buscarPrestatario({ dni, ruc }) →
//     { ok: true, data: { prestatarioId, tipo, identidad, clasificacion,
//                         bloqueos, elegible, motivo } }
//   obtenerHistorial(prestatarioId) →
//     { ok: true, data: { prestatario, elegibilidad, prestamos, expedientes } }
//     { ok: false, error: { code, message } }

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

function mapearError(error, mensajeRed) {
  if (typeof error?.payload?.code === 'string') {
    return { ok: false, error: error.payload }
  }
  if (error?.status === 401 || error?.status === 403) {
    return fallo('NO_AUTENTICADO', 'Se requiere sesión activa para consultar.')
  }
  if (error?.status === 404) {
    return fallo('NO_ENCONTRADO', 'No existe ficha para el documento consultado.')
  }
  return fallo('FALLO_RED', mensajeRed)
}

export async function buscarPrestatario({ dni, ruc }) {
  const consulta = dni ? `dni=${encodeURIComponent(dni)}` : `ruc=${encodeURIComponent(ruc)}`
  try {
    const cuerpo = await llamarFuncion('prestatarios', { path: `/buscar?${consulta}` })
    if (cuerpo?.resultado) return { ok: true, data: cuerpo.resultado }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de consulta.')
  } catch (error) {
    return mapearError(error, 'No se pudo contactar al servicio de consulta.')
  }
}

export async function listarPrestatarios() {
  try {
    const cuerpo = await llamarFuncion('prestatarios', { path: '/lista' })
    if (Array.isArray(cuerpo?.prestatarios)) return { ok: true, data: cuerpo.prestatarios }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al cargar prestatarios.')
  } catch (error) {
    return mapearError(error, 'No se pudo cargar la lista de prestatarios.')
  }
}

export async function obtenerHistorial(prestatarioId) {
  try {
    const cuerpo = await llamarFuncion('prestatarios', { path: `/${prestatarioId}/historial` })
    if (cuerpo?.historial) return { ok: true, data: cuerpo.historial }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de consulta.')
  } catch (error) {
    return mapearError(error, 'No se pudo obtener el historial del prestatario.')
  }
}
