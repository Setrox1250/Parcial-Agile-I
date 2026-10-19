import { esRucValido } from '../utils/ruc.js'
import { llamarFuncion } from './supabase.js'

// Consulta de identidad de empresa por RUC (HU-03).
//
// Contrato:
//   consultarRuc(ruc, representanteDni) →
//     { ok: true,  data: { numeroRuc, razonSocial, estado, condicion, direccion,
//                          departamento, provincia, distrito, ubigeo, estadoFicha,
//                          representanteDni, representanteRol, representanteEstado,
//                          avisoPoderes } }
//     { ok: false, error: { code, message, ...extras } }
//
// Códigos de error (Edge Function `ruc-lookup` es la autoridad):
//   RUC_INVALIDO, RUC_NO_ENCONTRADO, RUC_NO_HABIDO, DNI_INVALIDO,
//   PROVEEDOR_ERROR, RATE_LIMIT, FALLO_RED, NO_AUTENTICADO
//
// Con VITE_MOCK_RUC=1 se usa el mock en lugar de la Edge Function.

const MOCK_ACTIVO = import.meta.env.VITE_MOCK_RUC === '1'

function fallo(code, message, extras = {}) {
  return { ok: false, error: { code, message, ...extras } }
}

function exito(data) {
  return { ok: true, data }
}

export async function consultarRuc(ruc, representanteDni = '') {
  if (!esRucValido(ruc)) {
    return fallo('RUC_INVALIDO', 'El RUC debe tener 11 dígitos con dígito verificador válido.')
  }
  if (MOCK_ACTIVO) return consultarMock(ruc, representanteDni)
  return consultarEnServicio(ruc, representanteDni)
}

async function consultarEnServicio(ruc, representanteDni) {
  try {
    const cuerpo = await llamarFuncion('ruc-lookup', {
      method: 'POST',
      body: { ruc, representanteDni: representanteDni || undefined },
    })
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
    return fallo('FALLO_RED', error?.message || 'No se pudo contactar al servicio de RUC.')
  }
}

// --- Mock (VITE_MOCK_RUC=1) -------------------------------------------------
//   20131312955 → empresa NUEVA, RUC 20 (SUNAT)
//   10609933700 → persona natural con negocio (TITULAR derivado del DNI)
//   20123456789 → RUC NO HABIDO (bloquea originación)
//   20512345678 → RUC no encontrado

const ESCENARIOS_MOCK = {
  '20131312955': {
    razonSocial: 'SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA',
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    direccion: 'AV. GARCILASO DE LA VEGA 1472',
    departamento: 'LIMA',
    provincia: 'LIMA',
    distrito: 'JESUS MARIA',
    ubigeo: '150113',
    estadoFicha: 'NUEVO',
    representanteEstado: 'REPRESENTANTE_NO_VALIDADO',
  },
  '10609933700': {
    razonSocial: 'VALVERDE CEDRON SEBASTIAN',
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    direccion: 'AV. SIEMPRE VIVA',
    departamento: 'LIMA',
    provincia: 'LIMA',
    distrito: 'MIRAFLORES',
    ubigeo: '150122',
    estadoFicha: 'NUEVO',
    representanteDni: '60993370',
    representanteRol: 'TITULAR',
    representanteEstado: 'VINCULADO',
  },
}

async function consultarMock(ruc, representanteDni) {
  await new Promise((resolver) => setTimeout(resolver, 600))

  if (ruc.startsWith('205')) {
    return fallo('RUC_NO_ENCONTRADO', 'El RUC no fue encontrado en la fuente de consulta.')
  }
  if (ruc.startsWith('201234')) {
    return fallo('RUC_NO_HABIDO', 'El RUC no está ACTIVO y HABIDO. No se puede originar.', {
      estado: 'BAJA',
      condicion: 'NO HABIDO',
    })
  }

  const base = ESCENARIOS_MOCK[ruc] ?? {
    razonSocial: 'EMPRESA DE PRUEBA SAC',
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    direccion: 'AV. FALSA 123',
    departamento: 'LIMA',
    provincia: 'LIMA',
    distrito: 'LIMA',
    ubigeo: '150101',
    estadoFicha: 'NUEVO',
    representanteEstado: representanteDni ? 'VINCULADO' : 'SIN_REPRESENTANTE',
  }

  return exito({
    numeroRuc: ruc,
    representanteDni: representanteDni || base.representanteDni || null,
    avisoPoderes:
      'Un RUC ACTIVO/HABIDO no acredita por sí solo las facultades del representante (B-07).',
    ...base,
  })
}
