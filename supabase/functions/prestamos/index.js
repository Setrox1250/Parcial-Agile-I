// HU-05: originación de préstamos con cronograma francés TEA 30 % (CA-13/14/15).
//   POST /prestamos          → alta atómica e idempotente (requiere sesión).
//   POST /prestamos/preview  → cronograma sin persistir (vista previa 5.5).
// La sucursal se deriva de la sesión (RN-30); solo ADMIN elige sede explícita.
import { handleCors } from '../_shared/cors.js';
import { json, errorResponse } from '../_shared/response.js';
import { requireAuth, requireRole } from '../_shared/auth.js';
import { createAdminClient } from '../_shared/supabase.js';
import { generarCronograma, totalAPagar } from '../_shared/cronograma.js';
import {
  parseCuerpoOriginacion,
  parseCuerpoPreview,
  statusDeMotivo,
} from './validar.js';

const ROLES = ['SUPERVISOR_FINANCIERO', 'ADMIN'];

// RN-30: SUPERVISOR usa su sede de sesión; ADMIN elige (validada ACTIVA).
async function resolverSucursal(admin, perfil, sucursalId) {
  if (perfil.rol !== 'ADMIN') {
    if (!perfil.sucursal_id) {
      return { sucursalId: null, error: 'El perfil no tiene sucursal asignada.' };
    }
    return { sucursalId: perfil.sucursal_id, error: null };
  }
  const { data, error } = await admin
    .from('sucursales')
    .select('id')
    .eq('id', sucursalId)
    .eq('estado', 'ACTIVA')
    .single();
  if (error || !data) {
    return { sucursalId: null, error: 'La sucursal indicada no existe o no está activa.' };
  }
  return { sucursalId: data.id, error: null };
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse('Use POST', 405, 'METHOD_NOT_ALLOWED');
  }

  const { perfil, error: errorAuth } = await requireAuth(req);
  if (errorAuth) return errorAuth;
  const errorRol = requireRole(perfil, ROLES);
  if (errorRol) return errorRol;

  const { pathname } = new URL(req.url);
  const esPreview = pathname.endsWith('/preview');

  let cuerpo;
  try {
    cuerpo = await req.json();
  } catch {
    return errorResponse('Cuerpo JSON inválido', 400, 'VALIDATION_ERROR');
  }

  const admin = createAdminClient();

  // ---------------------------------------------------------------- preview
  if (esPreview) {
    const { datos, error } = parseCuerpoPreview(cuerpo);
    if (error) return errorResponse(error, 400, 'VALIDATION_ERROR');

    let cuotas;
    try {
      cuotas = generarCronograma(datos.monto, datos.plazo, datos.fecha);
    } catch (e) {
      return errorResponse(e.message, 400, 'VALIDATION_ERROR');
    }
    return json({
      preview: {
        tea: 0.30,
        monto: datos.monto,
        plazoMeses: datos.plazo,
        fechaOriginacion: datos.fecha,
        cuotas,
        totalAPagar: Math.round(totalAPagar(cuotas) * 100) / 100,
      },
    });
  }

  // ------------------------------------------------------------- originar
  const { datos, error } = parseCuerpoOriginacion(cuerpo, perfil.rol === 'ADMIN');
  if (error) return errorResponse(error, 400, 'VALIDATION_ERROR');

  const {
    sucursalId: sucursal,
    error: errorSucursal,
  } = await resolverSucursal(admin, perfil, datos.sucursalId);
  if (errorSucursal) return errorResponse(errorSucursal, 400, 'SUCURSAL_INVALIDA');

  let cuotas;
  try {
    cuotas = generarCronograma(datos.monto, datos.plazo, datos.fecha);
  } catch (e) {
    return errorResponse(e.message, 400, 'VALIDATION_ERROR');
  }

  const { data, error: errorRpc } = await admin.rpc('originar_prestamo', {
    p_prestatario_id: datos.prestatarioId,
    p_monto: datos.monto,
    p_plazo_meses: datos.plazo,
    p_sucursal_id: sucursal,
    p_fecha_originacion: datos.fecha,
    p_creado_por: perfil.auth_user_id,
    p_idempotency_key: datos.idempotencyKey,
    p_cuotas: cuotas,
  });

  if (errorRpc || !data) {
    return errorResponse('No se pudo originar el préstamo', 500, 'INTERNAL_ERROR');
  }
  if (!data.ok) {
    return errorResponse(
      `Originación rechazada: ${data.motivo}`,
      statusDeMotivo(data.motivo),
      data.motivo,
      { bloqueos: data.bloqueos, clasificacion: data.clasificacion },
    );
  }

  const { data: prestamo, error: errorPrestamo } = await admin
    .from('prestamos')
    .select('id, prestatario_id, sucursal_id, principal, tea, plazo_meses, estado, fecha_originacion, creado_en, idempotency_key')
    .eq('id', data.prestamo_id)
    .single();
  if (errorPrestamo) {
    return errorResponse('Préstamo creado pero no legible', 500, 'INTERNAL_ERROR');
  }

  return json(
    {
      prestamo: {
        id: prestamo.id,
        prestatarioId: prestamo.prestatario_id,
        sucursalId: prestamo.sucursal_id,
        principal: prestamo.principal,
        tea: prestamo.tea,
        plazoMeses: prestamo.plazo_meses,
        estado: prestamo.estado,
        fechaOriginacion: prestamo.fecha_originacion,
        creadoEn: prestamo.creado_en,
      },
      cuotas: data.cuotas,
      idempotente: data.idempotente,
    },
    data.idempotente ? 200 : 201,
  );
});
