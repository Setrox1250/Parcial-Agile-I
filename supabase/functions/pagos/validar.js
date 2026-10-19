// HU-07: utilidades de la ruta de pagos, sin side effects (testeables).

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor) {
  return typeof valor === "string" && UUID_RE.test(valor);
}

// Ruta: /pagos (lista/registro) o /pagos/<uuid> (verificación).
export function extraerIdPago(pathname) {
  const segmentos = pathname.split("/").filter(Boolean);
  const idx = segmentos.lastIndexOf("pagos");
  if (idx === -1) return null;
  if (segmentos.length === idx + 1) return "";
  if (segmentos.length === idx + 2) return segmentos[idx + 1] ?? "";
  return null;
}

const MEDIOS = new Set(["EFECTIVO", "TRANSFERENCIA"]);

// Importes en PEN con máximo dos decimales (moneda única del MVP).
function montoValido(valor) {
  const monto = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(monto) || monto <= 0) return null;
  if (Math.round(monto * 100) / 100 !== monto) return null;
  return monto;
}

// Body de registro de cobro (CA-18): prestamo_id, monto, medio y referencia.
export function parseRegistro(body) {
  const prestamoId = typeof body?.prestamo_id === "string" ? body.prestamo_id.trim() : "";
  if (!esUuid(prestamoId)) {
    return { prestamoId: null, monto: null, medio: null, referencia: null, idempotencyKey: null, error: "prestamo_id inválido" };
  }

  const monto = montoValido(body?.monto);
  if (monto === null) {
    return { prestamoId: null, monto: null, medio: null, referencia: null, idempotencyKey: null, error: "monto inválido: debe ser mayor que cero y con máximo dos decimales" };
  }

  const medio = String(body?.medio ?? "").trim().toUpperCase();
  if (!MEDIOS.has(medio)) {
    return { prestamoId: null, monto: null, medio: null, referencia: null, idempotencyKey: null, error: "medio inválido: use EFECTIVO o TRANSFERENCIA" };
  }

  const referencia = body?.referencia === undefined || body?.referencia === null
    ? null
    : String(body.referencia).trim();
  if (medio === "TRANSFERENCIA" && !referencia) {
    return { prestamoId: null, monto: null, medio: null, referencia: null, idempotencyKey: null, error: "la transferencia requiere referencia del abono" };
  }
  if (medio === "EFECTIVO" && referencia) {
    return { prestamoId: null, monto: null, medio: null, referencia: null, idempotencyKey: null, error: "el pago en efectivo no admite referencia" };
  }

  const idempotencyKey = body?.idempotency_key ? String(body.idempotency_key).trim() : null;
  if (body?.idempotency_key !== undefined && !idempotencyKey) {
    return { prestamoId: null, monto: null, medio: null, referencia: null, idempotencyKey: null, error: "idempotency_key vacía" };
  }

  return { prestamoId, monto, medio, referencia, idempotencyKey, error: null };
}

// Verificación de transferencia o reversión compensatoria auditada (HU-10).
export function parseVerificacion(body) {
  const accion = String(body?.accion ?? "").trim().toUpperCase();
  if (!["CONFIRMAR", "RECHAZAR", "REVERSAR"].includes(accion)) {
    return { accion: null, motivo: null, error: "acción inválida" };
  }
  const motivo = String(body?.motivo ?? "").trim();
  if (accion === "REVERSAR" && motivo.length < 5) {
    return { accion: null, motivo: null, error: "motivo de reversión inválido" };
  }
  return { accion, motivo: accion === "REVERSAR" ? motivo : null, error: null };
}
