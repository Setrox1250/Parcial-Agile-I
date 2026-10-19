import { llamarFuncion } from './supabase.js'
import { esDniCompleto } from '../utils/dni.js'

function fallo(code, message) {
  return { ok: false, error: { code, message } }
}

// Registra la evidencia de facultades de un representante ya validado por HU-02.
export async function acreditarRepresentante({ empresaId, representanteDni, fuente, evidenciaReferencia }) {
  if (!empresaId) return fallo('EMPRESA_INEXISTENTE', 'No se encontró la ficha de empresa.')
  if (!esDniCompleto(representanteDni)) {
    return fallo('DNI_INVALIDO', 'El DNI del representante debe tener 8 dígitos.')
  }
  if (String(fuente ?? '').trim().length < 3 || String(evidenciaReferencia ?? '').trim().length < 5) {
    return fallo('EVIDENCIA_INVALIDA', 'Indique la fuente y una referencia de la evidencia de facultades.')
  }

  try {
    const cuerpo = await llamarFuncion('representantes', {
      method: 'POST',
      body: { empresaId, representanteDni, fuente, evidenciaReferencia },
    })
    if (cuerpo?.representante) return { ok: true, data: cuerpo.representante }
    return fallo('RESPUESTA_INESPERADA', 'Respuesta inesperada al acreditar la representación.')
  } catch (error) {
    if (typeof error?.payload?.code === 'string') return { ok: false, error: error.payload }
    if (error?.status === 401 || error?.status === 403) {
      return fallo('NO_AUTENTICADO', 'Se requiere una sesión con permisos operativos.')
    }
    return fallo('FALLO_RED', error?.message || 'No se pudo acreditar la representación.')
  }
}
