import { llamarFuncion } from './supabase.js'
import { esRucValido } from '../utils/ruc.js'

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

// Consulta externa y opcional: solo sugiere el representante; no lo acredita.
export async function consultarRepresentanteLegal(ruc) {
  if (!esRucValido(ruc) || !ruc.startsWith('20')) {
    return fallo('RUC_INVALIDO', 'Ingrese un RUC válido de empresa (20).')
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
