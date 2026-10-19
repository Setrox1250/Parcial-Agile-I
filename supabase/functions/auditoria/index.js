// HU-10: consulta administrativa de trazabilidad. Solo ADMIN.
import { handleCors } from '../_shared/cors.js'
import { json, errorResponse } from '../_shared/response.js'
import { requireAuth, requireRole } from '../_shared/auth.js'
import { createAdminClient } from '../_shared/supabase.js'
import { corsHeaders } from '../_shared/cors.js'

const ACCIONES = new Set(['CREAR', 'ACTUALIZAR', 'REVERSAR', 'SISTEMA'])
const RESULTADOS = new Set(['EXITOSO', 'RECHAZADO', 'ERROR'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fechaValida(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor ?? '')
}

function escaparCsv(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor)
  return `"${texto.replaceAll('"', '""')}"`
}

function comoCsv(eventos) {
  const cabecera = ['fecha', 'accion', 'resultado', 'entidad', 'entidad_id', 'actor', 'rol', 'sucursal', 'correlacion', 'metadatos']
  const filas = eventos.map((e) => [e.fecha, e.accion, e.resultado, e.entidad, e.entidadId, e.actor, e.rol, e.sucursal, e.correlacion, JSON.stringify(e.metadatos ?? {})])
  return [cabecera, ...filas].map((fila) => fila.map(escaparCsv).join(',')).join('\n')
}

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight
  const { perfil, error } = await requireAuth(req)
  if (error) return error
  const rol = requireRole(perfil, ['ADMIN'])
  if (rol) return rol
  if (req.method !== 'GET') return errorResponse('Use GET /auditoria', 405, 'METHOD_NOT_ALLOWED')
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  const actor = url.searchParams.get('actor')
  const sucursalId = url.searchParams.get('sucursalId')
  const accion = url.searchParams.get('accion')
  const resultado = url.searchParams.get('resultado')
  const formato = url.searchParams.get('formato') ?? 'json'
  const limiteSolicitado = Number(url.searchParams.get('limite') ?? 200)
  const limite = Number.isInteger(limiteSolicitado) ? Math.min(Math.max(limiteSolicitado, 1), 500) : 200
  if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta)) ||
      (actor && !UUID_RE.test(actor)) || (sucursalId && !UUID_RE.test(sucursalId)) ||
      (accion && !ACCIONES.has(accion)) || (resultado && !RESULTADOS.has(resultado)) ||
      !['json', 'csv'].includes(formato)) {
    return errorResponse('Filtros de auditoría inválidos', 400, 'VALIDATION_ERROR')
  }
  const admin = createAdminClient()
  let consulta = admin.from('auditoria')
    .select('id, fecha, actor, rol, accion, resultado, entidad, entidad_id, correlacion, metadatos, sucursales(nombre)')
    .order('fecha', { ascending: false }).limit(limite)
  if (desde) consulta = consulta.gte('fecha', `${desde}T00:00:00-05:00`)
  if (hasta) consulta = consulta.lte('fecha', `${hasta}T23:59:59.999-05:00`)
  if (actor) consulta = consulta.eq('actor', actor)
  if (sucursalId) consulta = consulta.eq('sucursal_id', sucursalId)
  if (accion) consulta = consulta.eq('accion', accion)
  if (resultado) consulta = consulta.eq('resultado', resultado)
  const { data, error: consultaError } = await consulta
  if (consultaError) return errorResponse('No se pudo consultar la auditoría', 500, 'INTERNAL_ERROR')
  const eventos = (data ?? []).map((e) => ({ id:e.id, fecha:e.fecha, actor:e.actor, rol:e.rol, accion:e.accion, resultado:e.resultado, entidad:e.entidad, entidadId:e.entidad_id, correlacion:e.correlacion, sucursal:e.sucursales?.nombre ?? null, metadatos:e.metadatos }))
  if (formato === 'csv') {
    return new Response(`\uFEFF${comoCsv(eventos)}`, {
      headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="auditoria.csv"' },
    })
  }
  return json({ eventos })
})
