// HU-06: confirmación de desembolso (CA-16/CA-17) y anulación previa.
//
// Rutas:
//   GET    /desembolso           -> préstamos pendientes de desembolso de la
//                                   sucursal de la sesión (ADMIN: todos) y
//                                   evidencia reciente (CA-16).
//   GET    /desembolso/<uuid>    -> detalle de un préstamo + su desembolso.
//   POST   /desembolso/<uuid>    -> confirma la entrega de dinero (CA-16).
//   DELETE /desembolso/<uuid>    -> anula antes del desembolso y libera cupo
//                                   (CA-17, función liberar_reserva HU-04).
//
// RN-30: la sucursal de la operación se deriva de la sesión (la del préstamo
//        coincide por BD); el formulario nunca la aporta.
import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole, assertSucursalPropia } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";
import { esUuid, extraerIdPrestamo, parseConfirmacion } from "./validar.js";

const ROLES = ["ADMIN", "SUPERVISOR_FINANCIERO"];
const SELECT_PRESTAMO =
  "id, prestatario_id, sucursal_id, principal, plazo_meses, tea, estado, " +
  "creado_en, desembolsado_en, " +
  "prestatarios!inner(tipo, personas_naturales(dni, nombres, apellido_paterno, " +
  "apellido_materno), empresas(ruc, razon_social)), sucursales(nombre)";

function etiquetaPrestatario(prestamo) {
  const ficha = prestamo.prestatarios;
  if (!ficha) return null;
  if (ficha.tipo === "EMPRESA") {
    return ficha.empresas?.razon_social
      ? { tipo: "EMPRESA", documento: ficha.empresas.ruc, nombre: ficha.empresas.razon_social }
      : { tipo: "EMPRESA", documento: null, nombre: null };
  }
  const pn = ficha.personas_naturales;
  if (!pn) return { tipo: "PERSONA_NATURAL", documento: null, nombre: null };
  return {
    tipo: "PERSONA_NATURAL",
    documento: pn.dni,
    nombre: `${pn.nombres} ${pn.apellido_paterno} ${pn.apellido_materno}`.trim(),
  };
}

function formatearPrestamo(p) {
  return {
    id: p.id,
    estado: p.estado,
    principal: p.principal,
    plazoMeses: p.plazo_meses,
    tea: p.tea,
    sucursal: p.sucursales?.nombre ?? null,
    creadoEn: p.creado_en,
    desembolsadoEn: p.desembolsado_en,
    prestatario: etiquetaPrestatario(p),
  };
}

// Devuelve la lista de préstamos pendientes (y el historial de evidencias).
async function listar(admin, perfil) {
  if (perfil.rol !== "ADMIN" && !perfil.sucursal_id) {
    return errorResponse("La sesión no tiene sucursal asignada", 403, "FORBIDDEN_BRANCH");
  }

  let pendientes = admin
    .from("prestamos")
    .select(SELECT_PRESTAMO)
    .eq("estado", "PENDIENTE_DESEMBOLSO")
    .order("creado_en", { ascending: true });
  let historial = admin
    .from("desembolsos")
    .select("id, prestamo_id, importe, metodo, referencia, fecha, confirmo, sucursales(nombre)")
    .order("fecha", { ascending: false })
    .limit(20);

  if (perfil.rol !== "ADMIN") {
    pendientes = pendientes.eq("sucursal_id", perfil.sucursal_id);
    historial = historial.eq("sucursal_id", perfil.sucursal_id);
  }

  const [lista, evidencias] = await Promise.all([pendientes, historial]);
  if (lista.error || evidencias.error) {
    return errorResponse("No se pudo listar los desembolsos", 500, "INTERNAL_ERROR");
  }

  return json({
    pendientes: (lista.data ?? []).map(formatearPrestamo),
    historial: (evidencias.data ?? []).map((d) => ({
      id: d.id,
      prestamoId: d.prestamo_id,
      importe: d.importe,
      metodo: d.metodo,
      referencia: d.referencia,
      fecha: d.fecha,
      sucursal: d.sucursales?.nombre ?? null,
    })),
  });
}

// Carga el préstamo y aplica la segregación por sucursal de la sesión (RN-30).
async function cargarPrestamo(admin, perfil, prestamoId) {
  const { data, error } = await admin
    .from("prestamos")
    .select(SELECT_PRESTAMO)
    .eq("id", prestamoId)
    .maybeSingle();
  if (error) return { error: errorResponse("No se pudo leer el préstamo", 500, "INTERNAL_ERROR") };
  if (!data) return { error: errorResponse("Préstamo no encontrado", 404, "PRESTAMO_INEXISTENTE") };

  const errorSucursal = assertSucursalPropia(perfil, data.sucursal_id);
  if (errorSucursal) return { error: errorSucursal };
  return { prestamo: data };
}

// Evidencia CA-16 registrada para el préstamo (null si aún no se desembolsa).
async function leerDesembolso(admin, prestamoId) {
  const { data, error } = await admin
    .from("desembolsos")
    .select("id, prestamo_id, importe, metodo, referencia, fecha, confirmo, idempotency_key")
    .eq("prestamo_id", prestamoId)
    .maybeSingle();
  if (error) throw new Error("desembolso");
  return data
    ? {
        id: data.id,
        importe: data.importe,
        metodo: data.metodo,
        referencia: data.referencia,
        fecha: data.fecha,
        confirmo: data.confirmo,
      }
    : null;
}

async function detalle(admin, perfil, prestamoId) {
  const cargado = await cargarPrestamo(admin, perfil, prestamoId);
  if (cargado.error) return cargado.error;

  try {
    return json({
      prestamo: formatearPrestamo(cargado.prestamo),
      desembolso: await leerDesembolso(admin, prestamoId),
    });
  } catch {
    return errorResponse("No se pudo leer la evidencia", 500, "INTERNAL_ERROR");
  }
}

// CA-16: la entrega se confirma con método/referencia y el actor de la sesión.
async function confirmar(admin, perfil, prestamoId, body) {
  const cargado = await cargarPrestamo(admin, perfil, prestamoId);
  if (cargado.error) return cargado.error;

  const { metodo, referencia, idempotencyKey, error } = parseConfirmacion(body);
  if (error) return errorResponse(error, 400, "VALIDATION_ERROR");

  const { data, error: rpcError } = await admin.rpc("confirmar_desembolso", {
    p_prestamo_id: prestamoId,
    p_metodo: metodo,
    p_referencia: referencia,
    p_confirmo: perfil.auth_user_id,
    p_idempotency_key: idempotencyKey,
  });
  if (rpcError || !data) {
    return errorResponse("No se pudo confirmar el desembolso", 500, "INTERNAL_ERROR");
  }
  if (!data.ok) {
    const duplicado =
      data.motivo === "DESEMBOLLO_YA_CONFIRMADO" || data.motivo === "ESTADO_NO_DESEMBOLLABLE";
    return errorResponse(
      duplicado
        ? "El préstamo ya no está pendiente de desembolso"
        : "No se pudo confirmar el desembolso",
      duplicado ? 409 : 400,
      data.motivo ?? "VALIDATION_ERROR",
      { estado: data.estado ?? null },
    );
  }

  try {
    const desembolso = await leerDesembolso(admin, prestamoId);
    const { data: actualizado, error: errorLectura } = await admin
      .from("prestamos")
      .select(SELECT_PRESTAMO)
      .eq("id", prestamoId)
      .single();
    if (errorLectura || !actualizado) throw new Error("prestamo");
    return json(
      {
        prestamo: formatearPrestamo(actualizado),
        desembolso,
        idempotente: data.idempotente === true,
      },
      data.idempotente === true ? 200 : 201,
    );
  } catch {
    // La confirmación ya quedó persistida; el cliente puede releer el detalle.
    return errorResponse(
      "Desembolso confirmado; no se pudo componer la respuesta",
      500,
      "INTERNAL_ERROR",
    );
  }
}

// CA-17: anulación antes de la entrega; libera la reserva de cupo (HU-04).
async function anular(admin, perfil, prestamoId) {
  const cargado = await cargarPrestamo(admin, perfil, prestamoId);
  if (cargado.error) return cargado.error;

  const { data, error } = await admin.rpc("liberar_reserva", {
    p_prestamo_id: prestamoId,
  });
  if (error || !data) {
    return errorResponse("No se pudo anular el desembolso", 500, "INTERNAL_ERROR");
  }
  if (!data.ok) {
    return errorResponse(
      data.motivo === "PRESTAMO_INEXISTENTE"
        ? "Préstamo no encontrado"
        : "Solo se anula un préstamo pendiente de desembolso",
      data.motivo === "PRESTAMO_INEXISTENTE" ? 404 : 409,
      data.motivo ?? "ESTADO_NO_RESERVADO",
      { estado: data.estado ?? null },
    );
  }

  return json({
    prestamoId,
    estado: data.estado,
    motivo: null,
    cupoLiberado: cargado.prestamo.principal,
  });
}

function metodoNoPermitido() {
  return errorResponse("Use GET, POST o DELETE", 405, "METHOD_NOT_ALLOWED");
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const { perfil, error: errorAuth } = await requireAuth(req);
  if (errorAuth) return errorAuth;

  const errorRol = requireRole(perfil, ROLES);
  if (errorRol) return errorRol;

  const { pathname } = new URL(req.url);
  const prestamoId = extraerIdPrestamo(pathname);
  if (prestamoId === null) {
    return errorResponse("Ruta inválida: use /desembolso o /desembolso/<uuid>", 400, "VALIDATION_ERROR");
  }
  if (prestamoId && !esUuid(prestamoId)) {
    return errorResponse("Identificador de préstamo inválido", 400, "VALIDATION_ERROR");
  }

  const admin = createAdminClient();

  if (req.method === "GET") {
    return prestamoId ? detalle(admin, perfil, prestamoId) : listar(admin, perfil);
  }

  if (!prestamoId) return metodoNoPermitido();

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Cuerpo JSON inválido", 400, "INVALID_JSON");
    }
    return confirmar(admin, perfil, prestamoId, body);
  }

  if (req.method === "DELETE") {
    return anular(admin, perfil, prestamoId);
  }

  return metodoNoPermitido();
});
