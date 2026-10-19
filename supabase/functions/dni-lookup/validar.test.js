import {
  edadEnLima,
  normalizarFecha,
  normalizarNombre,
  primerValor,
} from './validar.js'

Deno.test('HU02: acepta columnas RENIEC y alias del proveedor', () => {
  const registro = { D_NUDNI: '60993370', preNombres: '  María ' }
  if (primerValor(registro, ['nuDni', 'D_NUDNI']) !== '60993370') throw new Error('no mapeó D_NUDNI')
  if (primerValor(registro, ['D_PRENOMBRES', 'preNombres']) !== 'María') throw new Error('no mapeó alias')
})

Deno.test('HU02: normaliza nombres ignorando acentos y espacios', () => {
  if (normalizarNombre('  José   de la Cruz ') !== 'JOSE DE LA CRUZ') throw new Error('normalización incorrecta')
})

Deno.test('HU02: normaliza fechas ISO y formato latino', () => {
  if (normalizarFecha('1990-04-09T00:00:00Z') !== '1990-04-09') throw new Error('ISO incorrecto')
  if (normalizarFecha('9/4/1990') !== '1990-04-09') throw new Error('formato latino incorrecto')
  if (normalizarFecha('sin fecha') !== '') throw new Error('aceptó fecha inválida')
})

Deno.test('HU02: calcula edad en America/Lima en el borde del cumpleaños', () => {
  const antes = new Date('2026-10-19T04:59:59.000Z') // 23:59:59 del 18/10 en Lima
  const despues = new Date('2026-10-19T05:00:00.000Z') // 00:00:00 del 19/10 en Lima
  if (edadEnLima('2008-10-19', antes) !== 17) throw new Error('debía ser menor antes del cumpleaños')
  if (edadEnLima('2008-10-19', despues) !== 18) throw new Error('debía cumplir 18 en Lima')
})
