// HU-06: utilidades de la ruta de desembolso, sin side effects (testeables).

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor) {
  return typeof valor === "string" && UUID_RE.test(valor);
}

// Rutas: /desembolso (lista) o /desembolso/<uuid> (detalle/confirmación).
export function extraerIdPrestamo(pathname) {
  const segmentos = pathname.split("/").filter(Boolean);
  const idx = segmentos.lastIndexOf("desembolso");
  if (idx === -1) return null;
  if (segmentos.length === idx + 1) return "";
  if (segmentos.length === idx + 2) return segmentos[idx + 1] ?? "";
  return null;
}

const METODOS = new Set(["EFECTIVO", "TRANSFERENCIA"]);

// Body de la confirmación: método obligatorio; referencia solo transferencia.
export function parseConfirmacion(body) {
  const metodo = String(body?.metodo ?? "").trim().toUpperCase();
  if (!METODOS.has(metodo)) {
    return { metodo: null, referencia: null, idempotencyKey: null, error: "método inválido: use EFECTIVO o TRANSFERENCIA" };
  }
  const referenciaBruta = body?.referencia;
  const referencia =
    referenciaBruta === undefined || referenciaBruta === null
      ? null
      : String(referenciaBruta).trim();

  if (metodo === "TRANSFERENCIA" && !referencia) {
    return { metodo: null, referencia: null, idempotencyKey: null, error: "la transferencia requiere referencia del abono" };
  }
  if (metodo === "EFECTIVO" && referencia) {
    return { metodo: null, referencia: null, idempotencyKey: null, error: "el pago en efectivo no admite referencia" };
  }

  const idempotencyKey = body?.idempotency_key
    ? String(body.idempotency_key).trim()
    : null;
  if (body?.idempotency_key !== undefined && !idempotencyKey) {
    return { metodo: null, referencia: null, idempotencyKey: null, error: "idempotency_key vacía" };
  }

  return { metodo, referencia, idempotencyKey, error: null };
}
