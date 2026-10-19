import { llamarFuncion } from './supabase.js'
import { esRucValido } from '../utils/ruc.js'

const MOCK_ACTIVO = import.meta.env.VITE_MOCK_RUC === '1'

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

// Consulta externa y opcional: solo sugiere el representante; no lo acredita.
export async function consultarRepresentanteLegal(ruc) {
  if (!esRucValido(ruc) || !ruc.startsWith('20')) {
    return fallo('RUC_INVALIDO', 'Ingrese un RUC válido de empresa (20).')
  }

  if (MOCK_ACTIVO) {
    if (ruc === '20131312955') {
      return {
        ok: true,
        data: {
          dni: '99000001',
          nombres: 'Ana Lucía Torres Mendoza',
          cargo: 'REPRESENTANTE LEGAL',
          fechaNombramiento: '2024-01-15',
          estadoCargo: 'VIGENTE',
          proveedor: 'JSON.pe (mock)',
        },
      }
    }
    return fallo('REPRESENTANTE_NO_ENCONTRADO', 'El mock no tiene un representante para este RUC.')
  }

  try {
    const cuerpo = await llamarFuncion('representante-lookup', {
      method: 'POST',
      body: { ruc },
    })
    if (cuerpo?.representante?.dni) return { ok: true, data: cuerpo.representante }
    return fallo('RESPUESTA_INESPERADA', 'El proveedor no devolvió un representante utilizable.')
  } catch (error) {
    if (typeof error?.payload?.code === 'string') return { ok: false, error: error.payload }
    if (error?.status === 401 || error?.status === 403) {
      return fallo('NO_AUTENTICADO', 'Se requiere una sesión con permisos operativos.')
    }
    return fallo('FALLO_RED', error?.message || 'No se pudo consultar al proveedor de representante legal.')
  }
}
