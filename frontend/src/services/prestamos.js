import { llamarFuncion } from './supabase.js'

// Originación de préstamos con cronograma (HU-05).
//
// Contrato:
//   previewCronograma({ monto, plazoMeses, fechaOriginacion }) →
//     { ok: true, data: { tea, monto, plazoMeses, fechaOriginacion,
//                         cuotas: [{ numero, vencimiento, capital, interes,
//                                     total }], totalAPagar } }
//   originarPrestamo({ prestatarioId, monto, plazoMeses, fechaOriginacion,
//                      sucursalId, idempotencyKey }) →
//     { ok: true, data: { prestamo, cuotas, idempotente } }
//     { ok: false, error: { code, message } }

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

function mapearError(error) {
  if (typeof error?.payload?.code === 'string') {
    return { ok: false, error: error.payload }
  }
  if (error?.status === 401 || error?.status === 403) {
    return fallo('NO_AUTORIZADO', 'Su rol no puede originar préstamos.')
  }
  if (error?.status === 404) {
    return fallo('PRESTATARIO_NO_ENCONTRADO', 'No existe la ficha del prestatario.')
  }
  if (error?.status === 409) {
    return fallo(error?.payload?.code ?? 'NO_ELEGIBLE', error?.payload?.message ??
      'El prestatario no es elegible para este monto.')
  }
  return fallo('FALLO_RED', 'No se pudo contactar al servicio de préstamos.')
}

export async function previewCronograma({ monto, plazoMeses, fechaOriginacion }) {
  try {
    const cuerpo = await llamarFuncion('prestamos', {
      method: 'POST',
      path: '/preview',
      body: { monto, plazoMeses, fechaOriginacion },
    })
    if (cuerpo?.preview) return { ok: true, data: cuerpo.preview }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de préstamos.')
  } catch (error) {
    return mapearError(error)
  }
}

export async function originarPrestamo({
  prestatarioId,
  monto,
  plazoMeses,
  fechaOriginacion,
  sucursalId,
  idempotencyKey,
}) {
  try {
    const cuerpo = await llamarFuncion('prestamos', {
      method: 'POST',
      body: { prestatarioId, monto, plazoMeses, fechaOriginacion, sucursalId, idempotencyKey },
    })
    if (cuerpo?.prestamo) return { ok: true, data: cuerpo }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de préstamos.')
  } catch (error) {
    return mapearError(error)
  }
}
