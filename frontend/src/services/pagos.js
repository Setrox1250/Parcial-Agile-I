import { llamarFuncion } from './supabase.js'

// Cobranza: registro de pagos y verificación manual de transferencias (HU-07).
//
// Contrato:
//   listarCobranza() →
//     { ok: true, data: { prestamos: [{ id, principal, plazoMeses, estado,
//                                       sucursal, creadoEn, desembolsadoEn,
//                                       cuotas: [{ numero, vencimiento, montoProgramado,
//                                                  montoAbonado, saldo, estado }],
//                                       prestatario: { tipo, documento, nombre } }],
//                         pendientes: [pago], recientes: [pago] } }
//     { ok: false, error: { code, message } }
//   registrarPago({ prestamoId, monto, medio, referencia, idempotencyKey }) →
//     { ok: true, data: { pago, idempotente } }
//   verificarPago(pagoId, accion) con accion 'CONFIRMAR' | 'RECHAZAR' →
//     { ok: true, data: { pago } }
//
// En esta base `pago.imputadoEn` es null: la imputación a cuotas llega con
// HU-05 (CA-19..CA-21); aquí solo se registra y verifica el cobro.

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

function mapearError(error, mensajeRed) {
  if (typeof error?.payload?.code === 'string') {
    return { ok: false, error: error.payload }
  }
  if (error?.status === 401 || error?.status === 403) {
    return fallo('NO_AUTENTICADO', 'Se requiere sesión activa para operar la cobranza.')
  }
  if (error?.status === 404) {
    return fallo('NO_ENCONTRADO', 'El registro consultado no existe.')
  }
  return fallo('FALLO_RED', mensajeRed)
}

export async function listarCobranza() {
  try {
    const cuerpo = await llamarFuncion('pagos')
    if (Array.isArray(cuerpo?.prestamos)) return { ok: true, data: cuerpo }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada del servicio de cobranza.')
  } catch (error) {
    return mapearError(error, 'No se pudo cargar la cobranza de la sucursal.')
  }
}

export async function registrarPago({ prestamoId, monto, medio, referencia, idempotencyKey }) {
  if (!prestamoId) {
    return fallo('PRESTAMO_REQUERIDO', 'Seleccione el préstamo que se está cobrando.')
  }
  if (!Number.isFinite(Number(monto)) || Number(monto) <= 0) {
    return fallo('MONTO_INVALIDO', 'El monto debe ser mayor que cero.')
  }

  try {
    const cuerpo = await llamarFuncion('pagos', {
      method: 'POST',
      body: {
        prestamo_id: prestamoId,
        monto: Number(monto),
        medio,
        ...(medio === 'TRANSFERENCIA' ? { referencia: referencia?.trim() ?? '' } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    })
    if (cuerpo?.pago) return { ok: true, data: cuerpo }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al registrar el cobro.')
  } catch (error) {
    return mapearError(error, 'No se pudo registrar el cobro.')
  }
}

export async function verificarPago(pagoId, accion) {
  try {
    const cuerpo = await llamarFuncion('pagos', {
      method: 'PATCH',
      path: `/${pagoId}`,
      body: { accion },
    })
    if (cuerpo?.pago) return { ok: true, data: cuerpo }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al verificar el cobro.')
  } catch (error) {
    return mapearError(error, 'No se pudo verificar el cobro.')
  }
}
