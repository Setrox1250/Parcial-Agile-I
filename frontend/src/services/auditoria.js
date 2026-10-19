import { llamarFuncion } from './supabase.js'
export async function listarAuditoria() {
  try { const data = await llamarFuncion('auditoria'); return Array.isArray(data?.eventos) ? { ok:true, data } : { ok:false, error:{ message:'Respuesta inesperada.' } } }
  catch (error) { return { ok:false, error:{ message:error?.payload?.message ?? 'No se pudo cargar la auditoría.' } } }
}
