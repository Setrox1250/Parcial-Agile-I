import { esDniCompleto } from '../utils/dni.js'
import { llamarFuncion } from './supabase.js'

// Consulta de identidad por DNI (HU-02).
//
// Contrato:
//   consultarDni(dni) →
//     { ok: true,  data: { numeroDni, nombres, apellidos, nombreCompleto,
//                          fechaNacimiento, edad, estadoFicha, dniVigente } }
//     { ok: false, error: { code, message, ...extras } }
//
// Códigos de error (backend/Edge Function `dni-lookup` es la autoridad):
//   DNI_INVALIDO, DNI_NO_ENCONTRADO, MENOR_EDAD, DISCREPANCIA_NOMBRE,
//   PROVEEDOR_ERROR, RATE_LIMIT, FALLO_RED, NO_AUTENTICADO, DNI_INCONSISTENTE
//
// Con VITE_MOCK_DNI=1 se usa el mock en lugar de la Edge Function.

const MOCK_ACTIVO = import.meta.env.VITE_MOCK_DNI === '1'

function fallo(code, message, extras = {}) {
  return { ok: false, error: { code, message, ...extras } }
}

function exito(data) {
  return { ok: true, data }
}

function calcularEdad(fechaNacimiento) {
  const hoy = new Date()
  const nac = new Date(`${fechaNacimiento}T12:00:00`)
  let edad = hoy.getFullYear() - nac.getFullYear()
  const mes = hoy.getMonth() - nac.getMonth()
  if (mes < 0 || (mes === 0 && hoy.getDate() < nac.getDate())) edad -= 1
  return edad
}

function armarFicha({ numeroDni, nombres, apellidos, fechaNacimiento, estadoFicha }) {
  return {
    numeroDni,
    nombres,
    apellidos,
    nombreCompleto: `${nombres} ${apellidos}`.trim(),
    fechaNacimiento,
    edad: calcularEdad(fechaNacimiento),
    estadoFicha,
    // B-01: Scrall Básico no entrega caducidad; nunca se afirma vigencia.
    dniVigente: null,
  }
}

export async function consultarDni(dni) {
  if (!esDniCompleto(dni)) {
    return fallo('DNI_INVALIDO', 'El DNI debe tener exactamente 8 dígitos.')
  }
  if (MOCK_ACTIVO) return consultarMock(dni)
  return consultarEnServicio(dni)
}

async function consultarEnServicio(dni) {
  // llamarFuncion adjunta el JWT de la sesión y el error tipificado del backend.
  try {
    const cuerpo = await llamarFuncion('dni-lookup', { method: 'POST', body: { dni } })
    if (cuerpo?.data) return exito(cuerpo.data)
    return fallo('PROVEEDOR_ERROR', 'Respuesta inesperada del servicio.')
  } catch (error) {
    if (typeof error?.payload?.code === 'string') {
      return { ok: false, error: error.payload }
    }
    if (error?.status === 401 || error?.status === 403) {
      return fallo('NO_AUTENTICADO', 'Sesión requerida para consultar identidad.')
    }
    if (error?.status === 429) {
      return fallo('RATE_LIMIT', error.message || 'Demasiadas consultas. Espere unos segundos.')
    }
    return fallo('FALLO_RED', error?.message || 'No se pudo contactar al servicio de identidad.')
  }
}

// --- Mock (VITE_MOCK_DNI=1) -------------------------------------------------
// Escenarios para decidir valores y comportamiento del formulario:
//   12345678 → ficha NUEVA            87654321 → ficha EXISTENTE
//   22222222 → menor de edad          44444444 → discrepancia de nombre
//   99999999 → DNI no encontrado      55555555 → error del proveedor
//   77777777 → límite de consultas    otro     → éxito genérico

const ESCENARIOS_MOCK = {
  '12345678': {
    nombres: 'Juan Carlos',
    apellidos: 'Ramírez Salas',
    fechaNacimiento: '1990-04-12',
    estadoFicha: 'NUEVO',
  },
  '87654321': {
    nombres: 'María Elena',
    apellidos: 'Quispe Ramos',
    fechaNacimiento: '1985-11-03',
    estadoFicha: 'EXISTENTE',
  },
  '00123456': {
    nombres: 'Sin Cero',
    apellidos: 'A La Izquierda',
    fechaNacimiento: '1992-07-20',
    estadoFicha: 'NUEVO',
  },
}

const ERRORES_MOCK = {
  '22222222': () => fallo('MENOR_EDAD', 'La persona es menor de 18 años.'),
  '44444444': () =>
    fallo('DISCREPANCIA_NOMBRE', 'El nombre registrado difiere de la consulta.', {
      nombreRegistrado: 'Luis Alberto Torres Vega',
      nombreConsultado: 'Luis Alberto Torres Vela',
    }),
  '99999999': () => fallo('DNI_NO_ENCONTRADO', 'El DNI no fue encontrado.'),
  '55555555': () => fallo('PROVEEDOR_ERROR', 'Error del proveedor de identidad.'),
  '77777777': () => fallo('RATE_LIMIT', 'Límite de consultas alcanzado (2 cada 10 s).'),
}

async function consultarMock(dni) {
  await new Promise((resolver) => setTimeout(resolver, 600))

  const escenarioError = ERRORES_MOCK[dni]
  if (escenarioError) return escenarioError()

  const ficha = ESCENARIOS_MOCK[dni] ?? {
    nombres: 'Nombre De Prueba',
    apellidos: 'Mock Genérico',
    fechaNacimiento: '1995-01-01',
    estadoFicha: 'NUEVO',
  }
  return exito(armarFicha({ numeroDni: dni, ...ficha }))
}
