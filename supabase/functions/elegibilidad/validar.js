// HU-04: utilidades de la ruta de elegibilidad, sin side effects (testeables).

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor) {
  return typeof valor === "string" && UUID_RE.test(valor);
}

// Ruta esperada: GET /elegibilidad/<uuid> (el gateway enruta por el primer
// segmento = nombre de la función).
export function extraerIdPrestatario(pathname) {
  const segmentos = pathname.split("/").filter(Boolean);
  const idx = segmentos.lastIndexOf("elegibilidad");
  if (idx === -1) return null;
  if (segmentos.length !== idx + 2) return null;
  return segmentos[idx + 1] ?? null;
}

// monto es opcional en la query string; ausente = reporte de cupo (§4.1).
export function parseMonto(searchParams) {
  const bruto = searchParams.get("monto");
  if (bruto === null || bruto === "") return { monto: null, error: null };
  const monto = Number(bruto);
  if (!Number.isFinite(monto)) return { monto: null, error: "monto inválido" };
  return { monto, error: null };
}
