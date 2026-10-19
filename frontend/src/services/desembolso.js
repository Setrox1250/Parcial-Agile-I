import { llamarFuncion } from './supabase.js'

// Desembolso de préstamos (HU-06): lista, confirmación y anulación previa.
//
// Contrato:
//   listarDesembolsos() →
//     { ok: true, data: { pendientes: [{ id, estado, principal, plazoMeses,
//          tea, sucursal, creadoEn, desembolsadoEn,
//          prestatario: { tipo, documento, nombre } }],
//          historial: [{ id, prestamoId, importe, metodo, referencia, fecha,
//          sucursal }] } }
//   confirmarDesembolso(prestamoId, { metodo, referencia, idempotencyKey }) →
//     { ok: true, data: { prestamo, desembolso, idempotente } }
//   anularDesembolso(prestamoId) →
//     { ok: true, data: { prestamoId, estado, cupoLiberado } }
//   Fallo: { ok: false, error: { code, message } }

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

function traducir(error, codigo) {
  if (typeof error?.payload?.code === 'string') return { ok: false, error: error.payload }
  if (error?.status === 401 || error?.status === 403) {
    return fallo('NO_AUTORIZADO', 'La sesión no puede operar desembolsos en esta sucursal.')
  }
  if (error?.status === 404) {
    return fallo('PRESTAMO_NO_ENCONTRADO', 'No existe el préstamo indicado.')
  }
  if (error?.status === 409) {
    return fallo(codigo, 'El préstamo ya no está pendiente de desembolso.')
  }
  return fallo(codigo, 'No se pudo contactar al servicio de desembolso.')
}

export async function listarDesembolsos() {
  try {
    const cuerpo = await llamarFuncion('desembolso')
    if (cuerpo && Array.isArray(cuerpo.pendientes)) {
      return { ok: true, data: { pendientes: cuerpo.pendientes, historial: cuerpo.historial ?? [] } }
    }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de desembolso.')
  } catch (error) {
    return traducir(error, 'FALLO_LISTADO')
  }
}

export async function confirmarDesembolso(prestamoId, { metodo, referencia, idempotencyKey } = {}) {
  if (!prestamoId) return fallo('PRESTAMO_REQUERIDO', 'Falta el identificador del préstamo.')

  try {
    const cuerpo = await llamarFuncion('desembolso', {
      method: 'POST',
      path: `/${prestamoId}`,
      body: {
        metodo,
        ...(metodo === 'TRANSFERENCIA' ? { referencia } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    })
    if (cuerpo?.prestamo) return { ok: true, data: cuerpo }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al confirmar el desembolso.')
  } catch (error) {
    return traducir(error, 'NO_SE_PUDO_CONFIRMAR')
  }
}

export async function editarPrestamoPendiente(prestamoId, { monto, plazoMeses }) {
  if (!prestamoId) return fallo('PRESTAMO_REQUERIDO', 'Falta el identificador del préstamo.')
  try {
    const cuerpo = await llamarFuncion('desembolso', {
      method: 'PUT',
      path: `/${prestamoId}`,
      body: { monto, plazoMeses },
    })
    return cuerpo?.prestamo
      ? { ok: true, data: cuerpo }
      : fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al editar el préstamo.')
  } catch (error) {
    return traducir(error, 'NO_SE_PUDO_EDITAR')
  }
}

export async function anularDesembolso(prestamoId) {
  if (!prestamoId) return fallo('PRESTAMO_REQUERIDO', 'Falta el identificador del préstamo.')

  try {
    const cuerpo = await llamarFuncion('desembolso', {
      method: 'DELETE',
      path: `/${prestamoId}`,
    })
    if (cuerpo?.prestamoId) return { ok: true, data: cuerpo }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al anular el desembolso.')
  } catch (error) {
    return traducir(error, 'NO_SE_PUDO_ANULAR')
  }
}
