// HU-03 / CA-08: acreditación manual de facultades de representación.
// La persona debe haber pasado previamente por HU-02; esta función solo
// registra la evidencia operativa y habilita la originación empresarial.
import { handleCors } from '../_shared/cors.js'
import { json, errorResponse } from '../_shared/response.js'
import { requireAuth, requireRole } from '../_shared/auth.js'
import { createAdminClient } from '../_shared/supabase.js'

const ROLES_PERMITIDOS = ['ADMIN', 'SUPERVISOR_FINANCIERO']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : ''
}

function respuestaDeMotivo(motivo) {
  const respuestas = {
    EMPRESA_INEXISTENTE: ['No existe una empresa para la ficha indicada.', 404],
    DNI_INVALIDO: ['El DNI del representante debe tener 8 dígitos.', 400],
    DNI_NO_VALIDADO: ['Primero valide el DNI del representante en el flujo de identidad.', 422],
    EVIDENCIA_INVALIDA: ['Indique la fuente y una referencia de evidencia de facultades válidas.', 400],
    ACTOR_INVALIDO: ['La sesión no corresponde a un usuario activo.', 403],
  }
  const [message, status] = respuestas[motivo] ?? ['No se pudo acreditar la representación.', 500]
  return errorResponse(message, status, motivo)
}

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('Use POST', 405, 'METHOD_NOT_ALLOWED')

  const { perfil, error: authError } = await requireAuth(req)
  if (authError) return authError
  const roleError = requireRole(perfil, ROLES_PERMITIDOS)
  if (roleError) return roleError

  let cuerpo
  try {
    cuerpo = await req.json()
  } catch {
    return errorResponse('Cuerpo JSON inválido', 400, 'INVALID_JSON')
  }

  const empresaId = texto(cuerpo?.empresaId)
  const representanteDni = texto(cuerpo?.representanteDni)
  const fuente = texto(cuerpo?.fuente)
  const evidenciaReferencia = texto(cuerpo?.evidenciaReferencia)

  if (!UUID_RE.test(empresaId)) {
    return errorResponse('La ficha de empresa no es válida.', 400, 'EMPRESA_INEXISTENTE')
  }
  if (!/^\d{8}$/.test(representanteDni)) {
    return errorResponse('El DNI del representante debe tener 8 dígitos.', 400, 'DNI_INVALIDO')
  }
  if (fuente.length < 3 || fuente.length > 100 || evidenciaReferencia.length < 5 || evidenciaReferencia.length > 500) {
    return errorResponse(
      'Indique fuente (3–100 caracteres) y referencia de evidencia (5–500 caracteres).',
      400,
      'EVIDENCIA_INVALIDA',
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('acreditar_representacion_empresa', {
    p_empresa_id: empresaId,
    p_representante_dni: representanteDni,
    p_fuente: fuente,
    p_evidencia_referencia: evidenciaReferencia,
    p_actor: perfil.auth_user_id,
  })

  if (error || !data) {
    console.error('representantes: fallo al acreditar', error?.code)
    return errorResponse('No se pudo acreditar la representación.', 500, 'INTERNAL_ERROR')
  }
  if (!data.ok) return respuestaDeMotivo(data.motivo)

  return json({
    representante: {
      id: data.representante_id,
      empresaId,
      dni: representanteDni,
      estado: 'ACREDITADO',
      idempotente: data.idempotente,
    },
  })
})
