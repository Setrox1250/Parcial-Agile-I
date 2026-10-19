// Funciones puras de normalización y validación usadas por la consulta Scrall.
// Se mantienen separadas para poder probar los bordes de HU-02 sin llamar al
// proveedor externo.

export function primerValor(registro, claves) {
  for (const clave of claves) {
    const valor = registro?.[clave]
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      return String(valor).trim()
    }
  }
  return ''
}

export function normalizarNombre(texto) {
  return String(texto ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

// Acepta YYYY-MM-DD (con o sin hora), DD/MM/YYYY y DD-MM-YYYY.
export function normalizarFecha(valor) {
  const texto = String(valor ?? '').trim()
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const latina = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (latina) {
    const [, dia, mes, anio] = latina
    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  }
  return ''
}

export function edadEnLima(fechaNacimiento, ahora = new Date()) {
  const hoyLima = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
  }).format(ahora)
  const [anioHoy, mesHoy, diaHoy] = hoyLima.split('-').map(Number)
  const [anioNac, mesNac, diaNac] = String(fechaNacimiento).split('-').map(Number)
  let edad = anioHoy - anioNac
  if (mesHoy < mesNac || (mesHoy === mesNac && diaHoy < diaNac)) edad -= 1
  return edad
}
