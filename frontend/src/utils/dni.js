// DNI peruano: 8 caracteres numéricos, conservando ceros a la izquierda.

export function normalizarDni(valor) {
  return String(valor ?? '').replace(/\D/g, '').slice(0, 8)
}

export function esDniCompleto(dni) {
  return /^\d{8}$/.test(dni)
}
