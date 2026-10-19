// HU-08: consulta de mora y expedientes extrajudiciales.
// GET  /mora           -> moras abiertas y expedientes del ámbito autorizado.
// POST /mora/procesar  -> reproceso manual, exclusivo de ADMIN. El proceso
//                         ordinario lo ejecuta pg_cron diariamente en BD.

import { handleCors } from '../_shared/cors.js'
import { json, errorResponse } from '../_shared/response.js'
import { requireAuth, requireRole } from '../_shared/auth.js'
import { createAdminClient } from '../_shared/supabase.js'
import { auditar, obtenerCorrelacion } from '../_shared/auditoria.js'

const ROLES_LECTURA = ['ADMIN', 'SUPERVISOR_FINANCIERO']
const SELECT_PRESTAMO =
  'id, sucursal_id, estado, prestatario_id, sucursales(nombre)'

function etiquetaFicha(ficha) {
  if (!ficha) return { tipo: null, documento: null, nombre: null }
  if (ficha.tipo === 'EMPRESA') {
    return {
      tipo: 'EMPRESA',
      documento: ficha.empresas?.ruc ?? null,
      nombre: ficha.empresas?.razon_social ?? null,
    }
  }
  const persona = ficha.personas_naturales
  return persona
    ? {
        tipo: 'PERSONA_NATURAL',
        documento: persona.dni,
        nombre: `${persona.nombres} ${persona.apellido_paterno} ${persona.apellido_materno}`.trim(),
      }
    : { tipo: 'PERSONA_NATURAL', documento: null, nombre: null }
}

async function cargarFichas(admin, prestatarioIds) {
  const ids = [...new Set(prestatarioIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await admin
    .from('prestatarios')
    .select(
      'id, tipo, personas_naturales(dni, nombres, apellido_paterno, apellido_materno), empresas(ruc, razon_social)',
    )
    .in('id', ids)
  if (error) throw new Error('fichas')
  return new Map((data ?? []).map((ficha) => [ficha.id, etiquetaFicha(ficha)]))
}

function formatearPrestamo(prestamo, fichas) {
  return {
    id: prestamo?.id ?? null,
    estado: prestamo?.estado ?? null,
    sucursal: prestamo?.sucursales?.nombre ?? null,
    prestatario: fichas.get(prestamo?.prestatario_id) ?? null,
  }
}

async function listar(admin, perfil) {
  let moras = admin
    .from('eventos_mora')
    .select(`id, prestamo_id, inicio_mora, monto_vencido, evidencia, creado_en, prestamos!inner(${SELECT_PRESTAMO})`)
    .is('fecha_fin', null)
    .order('inicio_mora', { ascending: true })
    .limit(100)
  let expedientes = admin
    .from('expedientes_extrajudicial')
    .select(
      `id, prestamo_id, evento_mora_id, fecha_escalamiento, estado, responsable, accion, resultado, creado_en, prestamos!inner(${SELECT_PRESTAMO})`,
    )
    .order('fecha_escalamiento', { ascending: true })
    .limit(100)

  if (perfil.rol !== 'ADMIN') {
    if (!perfil.sucursal_id) {
      return errorResponse('La sesión no tiene sucursal asignada', 403, 'FORBIDDEN_BRANCH')
    }
    moras = moras.eq('prestamos.sucursal_id', perfil.sucursal_id)
    expedientes = expedientes.eq('prestamos.sucursal_id', perfil.sucursal_id)
  }

  const [morasResultado, expedientesResultado] = await Promise.all([moras, expedientes])
  if (morasResultado.error || expedientesResultado.error) {
    return errorResponse('No se pudo consultar la mora', 500, 'INTERNAL_ERROR')
  }

  try {
    const fichas = await cargarFichas(admin, [
      ...(morasResultado.data ?? []).map((mora) => mora.prestamos?.prestatario_id),
      ...(expedientesResultado.data ?? []).map((expediente) => expediente.prestamos?.prestatario_id),
    ])
    return json({
      moras: (morasResultado.data ?? []).map((mora) => ({
        id: mora.id,
        inicioMora: mora.inicio_mora,
        montoVencido: mora.monto_vencido,
        evidencia: mora.evidencia ?? [],
        creadoEn: mora.creado_en,
        prestamo: formatearPrestamo(mora.prestamos, fichas),
      })),
      expedientes: (expedientesResultado.data ?? []).map((expediente) => ({
        id: expediente.id,
        eventoMoraId: expediente.evento_mora_id,
        fechaEscalamiento: expediente.fecha_escalamiento,
        estado: expediente.estado,
        responsable: expediente.responsable,
        accion: expediente.accion,
        resultado: expediente.resultado,
        creadoEn: expediente.creado_en,
        prestamo: formatearPrestamo(expediente.prestamos, fichas),
      })),
    })
  } catch {
    return errorResponse('No se pudo cargar la identidad de los prestatarios', 500, 'INTERNAL_ERROR')
  }
}

async function procesar(admin, perfil, correlacion) {
  if (perfil.rol !== 'ADMIN') {
    return errorResponse('Solo un administrador puede reprocesar la mora', 403, 'FORBIDDEN_ROLE')
  }
  const { data, error } = await admin.rpc('procesar_mora', { p_fecha: null })
  if (error || !data?.ok) {
    return errorResponse('No se pudo reprocesar la mora', 500, 'INTERNAL_ERROR')
  }
  await auditar(admin, {
    perfil, correlacion, accion: 'SISTEMA', entidad: 'procesar_mora',
    metadatos: { fecha: data.fecha ?? null, intentos: data.intentos ?? 1 },
  })
  return json({ proceso: data })
}

Deno.serve(async (req) => {
  const preflight = handleCors(req)
  if (preflight) return preflight

  const { perfil, error: errorAuth } = await requireAuth(req)
  if (errorAuth) return errorAuth
  const errorRol = requireRole(perfil, ROLES_LECTURA)
  if (errorRol) return errorRol
  const correlacion = obtenerCorrelacion(req)

  const { pathname } = new URL(req.url)
  const esRaiz = pathname.endsWith('/mora')
  const esProceso = pathname.endsWith('/mora/procesar')
  const admin = createAdminClient()

  if (req.method === 'GET' && esRaiz) return listar(admin, perfil)
  if (req.method === 'POST' && esProceso) return procesar(admin, perfil, correlacion)
  return errorResponse('Use GET /mora o POST /mora/procesar', 405, 'METHOD_NOT_ALLOWED')
})
