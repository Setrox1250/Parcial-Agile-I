import { llamarFuncion } from './supabase.js'

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

function mapearError(error, mensajeRed) {
  if (typeof error?.payload?.code === 'string') return { ok: false, error: error.payload }
  if (error?.status === 401 || error?.status === 403) {
    return fallo('NO_AUTORIZADO', 'No tiene permisos para consultar la mora.')
  }
  return fallo('FALLO_RED', mensajeRed)
}

export async function listarMora() {
  try {
    const cuerpo = await llamarFuncion('mora')
    if (Array.isArray(cuerpo?.moras) && Array.isArray(cuerpo?.expedientes)) {
      return { ok: true, data: cuerpo }
    }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de mora.')
  } catch (error) {
    return mapearError(error, 'No se pudo cargar la mora.')
  }
}

export async function reprocesarMora() {
  try {
    const cuerpo = await llamarFuncion('mora', { method: 'POST', path: '/procesar' })
    if (cuerpo?.proceso?.ok) return { ok: true, data: cuerpo.proceso }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al reprocesar la mora.')
  } catch (error) {
    return mapearError(error, 'No se pudo reprocesar la mora.')
  }
}
