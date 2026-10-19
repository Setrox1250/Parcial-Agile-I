import { llamarFuncion } from './supabase.js'
import { supabase } from './supabase.js'

function query(filtros = {}) {
  const params = new URLSearchParams()
  for (const [clave, valor] of Object.entries(filtros)) if (valor) params.set(clave, valor)
  return params.toString()
}

export async function listarAuditoria(filtros = {}) {
  try { const data = await llamarFuncion('auditoria', { path: query(filtros) ? `?${query(filtros)}` : '' }); return Array.isArray(data?.eventos) ? { ok:true, data } : { ok:false, error:{ message:'Respuesta inesperada.' } } }
  catch (error) { return { ok:false, error:{ message:error?.payload?.message ?? 'No se pudo cargar la auditoría.' } } }
}

export async function exportarAuditoria(filtros = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  const correlationId = crypto.randomUUID()
  const params = new URLSearchParams(query(filtros)); params.set('formato', 'csv')
  const respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auditoria?${params}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Correlation-Id': correlationId },
  })
  if (!respuesta.ok) throw new Error(`No se pudo exportar la auditoría (Código de soporte: ${correlationId})`)
  return respuesta.blob()
}
