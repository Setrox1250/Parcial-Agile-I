// Formato monetario en soles (PEN) — reutilizable en HU-05, HU-07 y HU-09.
export function soles(valor) {
  return `S/ ${Number(valor).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

// Fecha local YYYY-MM-DD (evita el desfase UTC de toISOString).
export function hoyLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}
