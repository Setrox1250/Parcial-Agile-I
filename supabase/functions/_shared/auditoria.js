// HU-10: traza de petición. El trigger SQL conserva además los cambios aun si
// una EF falla antes de componer su respuesta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function obtenerCorrelacion(req) {
  const recibida = req.headers.get('x-correlation-id')?.trim()
  return recibida && UUID_RE.test(recibida) ? recibida : crypto.randomUUID()
}

export async function auditar(admin, {
  perfil,
  correlacion,
  accion = 'SISTEMA',
  entidad,
  entidadId = null,
  resultado = 'EXITOSO',
  metadatos = {},
}) {
  const { error } = await admin.from('auditoria').insert({
    actor: perfil?.auth_user_id ?? null,
    rol: perfil?.rol ?? 'SISTEMA',
    sucursal_id: perfil?.sucursal_id ?? null,
    accion,
    entidad,
    entidad_id: entidadId,
    correlacion,
    resultado,
    metadatos,
  })
  // La operación financiera ya se confirmó de forma transaccional; no se la
  // revierte si falla una traza secundaria. El trigger de BD sigue cubriendo
  // el cambio material y deja el incidente visible en logs de la EF.
  if (error) console.error('auditoria_no_registrada', { entidad, entidadId, correlacion, error: error.message })
}
