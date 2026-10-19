// HU-10: consulta administrativa de trazabilidad. Solo ADMIN.
import { handleCors } from '../_shared/cors.js'
import { json, errorResponse } from '../_shared/response.js'
import { requireAuth, requireRole } from '../_shared/auth.js'
import { createAdminClient } from '../_shared/supabase.js'

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight
  const { perfil, error } = await requireAuth(req)
  if (error) return error
  const rol = requireRole(perfil, ['ADMIN'])
  if (rol) return rol
  if (req.method !== 'GET') return errorResponse('Use GET /auditoria', 405, 'METHOD_NOT_ALLOWED')
  const admin = createAdminClient()
  const { data, error: consultaError } = await admin.from('auditoria')
    .select('id, fecha, actor, rol, accion, entidad, entidad_id, correlacion, metadatos, sucursales(nombre)')
    .order('fecha', { ascending: false }).limit(200)
  if (consultaError) return errorResponse('No se pudo consultar la auditoría', 500, 'INTERNAL_ERROR')
  return json({ eventos: (data ?? []).map((e) => ({ id:e.id, fecha:e.fecha, actor:e.actor, rol:e.rol, accion:e.accion, entidad:e.entidad, entidadId:e.entidad_id, correlacion:e.correlacion, sucursal:e.sucursales?.nombre ?? null, metadatos:e.metadatos })) })
})
