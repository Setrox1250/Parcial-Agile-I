// HU-03 — Dominio del RUC peruano (puro, sin red).
//
// Un RUC son 11 dígitos: 10 de identificación + 1 dígito verificador (módulo 11
// con los pesos de SUNAT). Los prefijos 10 y 15 corresponden a persona natural
// con negocio; 17 y 20, a persona jurídica.
//
// En un RUC 10 el DNI del titular está EMBEBIDO: `10` + DNI(8) + verificador.
// Por eso se deriva (no se adivina) y se comprueba el dígito antes de confiar
// en él (un RUC mal tecleado daría un DNI plausible pero falso).

/** Pesos del módulo 11 que usa SUNAT para el dígito verificador del RUC. */
const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Dígito verificador de un RUC a partir de sus diez primeros dígitos. */
export function calcularDigitoVerificadorRuc(primerosDiez) {
  const suma = PESOS_RUC.reduce(
    (acc, peso, i) => acc + Number(primerosDiez[i]) * peso,
    0,
  );
  const resta = 11 - (suma % 11);
  if (resta === 10) return 0;
  if (resta === 11) return 1;
  return resta;
}

/** RUC válido: 11 dígitos y dígito verificador correcto. */
export function esRucValido(ruc) {
  const limpio = String(ruc ?? "").trim();
  if (!/^\d{11}$/.test(limpio)) return false;
  return calcularDigitoVerificadorRuc(limpio.slice(0, 10)) === Number(limpio[10]);
}

/** Prefijo de dos dígitos del RUC (o cadena vacía si no aplica). */
export function prefijoRuc(ruc) {
  const limpio = String(ruc ?? "").trim();
  return /^\d{11}$/.test(limpio) ? limpio.slice(0, 2) : "";
}

/** Los prefijos 10/15 identifican a una persona natural con negocio. */
export function esRucPersonaNatural(ruc) {
  const prefijo = prefijoRuc(ruc);
  return prefijo === "10" || prefijo === "15";
}

/** RUC de persona natural que le correspondería a un DNI, o null si no es DNI. */
export function rucDesdeDni(dni) {
  const limpio = String(dni ?? "").trim();
  if (!/^\d{8}$/.test(limpio)) return null;
  const primerosDiez = `10${limpio}`;
  return `${primerosDiez}${calcularDigitoVerificadorRuc(primerosDiez)}`;
}

/**
 * DNI embebido en un RUC 10, o null si no es un RUC 10 válido.
 * Comprueba el verificador: `dniDesdeRuc10(rucDesdeDni(d)) === d`.
 * (Un RUC 15 NO embebe el DNI; por eso solo se deriva del prefijo 10.)
 */
export function dniDesdeRuc10(ruc) {
  const limpio = String(ruc ?? "").trim();
  if (!/^10\d{9}$/.test(limpio)) return null;
  if (calcularDigitoVerificadorRuc(limpio.slice(0, 10)) !== Number(limpio[10])) {
    return null;
  }
  return limpio.slice(2, 10);
}
