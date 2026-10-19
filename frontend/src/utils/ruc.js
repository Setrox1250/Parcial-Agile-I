// RUC peruano: 11 dígitos con dígito verificador (módulo 11, pesos SUNAT).
// Validación en cliente SOLO como refuerzo; la autoridad es la Edge Function.

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function normalizarRuc(valor) {
  return String(valor ?? '').replace(/\D/g, '').slice(0, 11)
}

export function esRucCompleto(ruc) {
  return /^\d{11}$/.test(ruc)
}

export function calcularDigitoVerificadorRuc(primerosDiez) {
  const suma = PESOS_RUC.reduce((acc, peso, i) => acc + Number(primerosDiez[i]) * peso, 0)
  const resta = 11 - (suma % 11)
  if (resta === 10) return 0
  if (resta === 11) return 1
  return resta
}

export function esRucValido(ruc) {
  if (!esRucCompleto(ruc)) return false
  return calcularDigitoVerificadorRuc(ruc.slice(0, 10)) === Number(ruc[10])
}

// Prefijos 10/15 = persona natural con negocio (en 10, el DNI está embebido).
export function esRucPersonaNatural(ruc) {
  const prefijo = String(ruc ?? '').slice(0, 2)
  return prefijo === '10' || prefijo === '15'
}
