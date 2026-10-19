import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";
import { auditar, obtenerCorrelacion } from "../_shared/auditoria.js";

const ROLES = ["ADMIN", "SUPERVISOR_FINANCIERO"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function metodoNoPermitido() {
  return errorResponse("Use GET, POST o PATCH", 405, "METHOD_NOT_ALLOWED");
}

function extraerId(pathname) {
  const segmentos = pathname.split("/").filter(Boolean);
  const idx = segmentos.lastIndexOf("usuarios");
  if (idx === -1) return null;
  return segmentos.length > idx + 1 ? segmentos[idx + 1] : null;
}

// Valida la consistencia rol/sucursal exigida por el CHECK de la BD.
function validarRolSucursal(rol, sucursalId) {
  if (!ROLES.includes(rol)) return "Rol no permitido";
  if (rol === "SUPERVISOR_FINANCIERO" && !sucursalId) {
    return "SUPERVISOR_FINANCIERO requiere sucursal asignada";
  }
  return null;
}

// La sucursal indicada debe existir y estar ACTIVA (si se proporciona).
async function sucursalValida(admin, sucursalId) {
  if (!sucursalId) return { ok: true, nombre: null };
  const { data, error } = await admin
    .from("sucursales")
    .select("id, nombre, estado")
    .eq("id", sucursalId)
    .single();
  if (error || !data) return { ok: false, motivo: "Sucursal inexistente" };
  if (data.estado !== "ACTIVA") return { ok: false, motivo: "Sucursal inactiva" };
  return { ok: true, nombre: data.nombre };
}

async function listar(admin) {
  const { data, error } = await admin
    .from("perfiles")
    .select("id, auth_user_id, nombre_visible, rol, sucursal_id, activo, creado_en, actualizado_en, sucursales(nombre)")
    .order("creado_en", { ascending: false });
  if (error) return errorResponse("No se pudo listar los perfiles", 500, "INTERNAL_ERROR");

  // Emails desde la API de administración de Auth (solo para la lista de ADMIN).
  const { data: cuentas, error: errorCuentas } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const emails = new Map(
    (cuentas?.users ?? []).map((u) => [u.id, u.email ?? ""]),
  );
  void errorCuentas;

  const perfiles = data.map((p) => ({
    id: p.id,
    auth_user_id: p.auth_user_id,
    email: emails.get(p.auth_user_id) ?? null,
    nombre_visible: p.nombre_visible,
    rol: p.rol,
    sucursal_id: p.sucursal_id,
    sucursal_nombre: p.sucursales?.nombre ?? null,
    activo: p.activo,
    creado_en: p.creado_en,
    actualizado_en: p.actualizado_en,
  }));
  return json({ perfiles });
}

async function crear(admin, body, actor, correlacion) {
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const nombreVisible = String(body.nombre_visible ?? "").trim();
  const rol = String(body.rol ?? "").trim();
  const sucursalId = body.sucursal_id ?? null;

  if (!EMAIL_RE.test(email)) return errorResponse("Email inválido", 400, "VALIDATION_ERROR");
  if (password.length < MIN_PASSWORD) {
    return errorResponse(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, 400, "VALIDATION_ERROR");
  }
  if (!nombreVisible) return errorResponse("nombre_visible es obligatorio", 400, "VALIDATION_ERROR");

  const errorRol = validarRolSucursal(rol, sucursalId);
  if (errorRol) return errorResponse(errorRol, 400, "VALIDATION_ERROR");

  const sucursal = await sucursalValida(admin, sucursalId);
  if (!sucursal.ok) return errorResponse(sucursal.motivo, 400, "VALIDATION_ERROR");

  const { data: creado, error: errorAuth } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (errorAuth) {
    const duplicado = errorAuth.message?.toLowerCase().includes("already been registered");
    if (duplicado) return errorResponse("El email ya está registrado", 409, "EMAIL_EXISTS");
    return errorResponse("No se pudo crear la cuenta", 400, "AUTH_CREATE_ERROR");
  }

  const { data: perfil, error: errorPerfil } = await admin
    .from("perfiles")
    .insert({
      auth_user_id: creado.user.id,
      nombre_visible: nombreVisible,
      rol,
      sucursal_id: sucursalId,
      activo: true,
    })
    .select("id, auth_user_id, nombre_visible, rol, sucursal_id, activo, creado_en, actualizado_en")
    .single();

  if (errorPerfil) {
    // Rollback: no dejar cuenta de auth sin perfil.
    await admin.auth.admin.deleteUser(creado.user.id);
    return errorResponse("No se pudo crear el perfil", 400, "PERFIL_CREATE_ERROR");
  }

  await auditar(admin, {
    perfil: actor, correlacion, accion: "CREAR", entidad: "perfiles", entidadId: perfil.id,
    metadatos: { rol_asignado: perfil.rol, sucursal_id: perfil.sucursal_id },
  });

  return json({ perfil: { ...perfil, sucursal_nombre: sucursal.nombre } }, 201);
}

async function actualizar(admin, id, body, actor, correlacion) {
  const { data: actual, error } = await admin
    .from("perfiles")
    .select("id, auth_user_id, nombre_visible, rol, sucursal_id, activo")
    .eq("id", id)
    .single();
  if (error || !actual) return errorResponse("Perfil no encontrado", 404, "NOT_FOUND");

  const cambios = {};
  if (typeof body.activo === "boolean") cambios.activo = body.activo;
  if (body.rol !== undefined) cambios.rol = String(body.rol).trim();
  if (Object.prototype.hasOwnProperty.call(body, "sucursal_id")) cambios.sucursal_id = body.sucursal_id;

  if (Object.keys(cambios).length === 0) {
    return errorResponse("Sin cambios para aplicar", 400, "VALIDATION_ERROR");
  }

  const rolFinal = cambios.rol ?? actual.rol;
  const sucursalFinal = Object.prototype.hasOwnProperty.call(cambios, "sucursal_id")
    ? cambios.sucursal_id
    : actual.sucursal_id;

  const errorRol = validarRolSucursal(rolFinal, sucursalFinal);
  if (errorRol) return errorResponse(errorRol, 400, "VALIDATION_ERROR");

  const sucursal = await sucursalValida(admin, sucursalFinal);
  if (!sucursal.ok) return errorResponse(sucursal.motivo, 400, "VALIDATION_ERROR");

  const { data: perfil, error: errorUpdate } = await admin
    .from("perfiles")
    .update({ ...cambios, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .select("id, auth_user_id, nombre_visible, rol, sucursal_id, activo, creado_en, actualizado_en")
    .single();
  if (errorUpdate) return errorResponse("No se pudo actualizar el perfil", 500, "INTERNAL_ERROR");

  await auditar(admin, {
    perfil: actor, correlacion, accion: "ACTUALIZAR", entidad: "perfiles", entidadId: perfil.id,
    metadatos: { campos: Object.keys(cambios) },
  });

  return json({ perfil: { ...perfil, sucursal_nombre: sucursal.nombre } });
}

// Gestión de perfiles de usuario. Solo ADMIN (CA-03, CA-28).
Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const { perfil, error: errorAuth } = await requireAuth(req);
  if (errorAuth) return errorAuth;

  const errorRol = requireRole(perfil, ["ADMIN"]);
  if (errorRol) return errorRol;
  const correlacion = obtenerCorrelacion(req);

  const admin = createAdminClient();
  const { pathname } = new URL(req.url);
  const id = extraerId(pathname);

  if (req.method === "GET") {
    if (id) return metodoNoPermitido();
    return listar(admin);
  }

  if (req.method === "POST") {
    if (id) return metodoNoPermitido();
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Cuerpo JSON inválido", 400, "INVALID_JSON");
    }
    return crear(admin, body, perfil, correlacion);
  }

  if (req.method === "PATCH") {
    if (!id) {
      return errorResponse("Indique el id del perfil a actualizar", 400, "VALIDATION_ERROR");
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Cuerpo JSON inválido", 400, "INVALID_JSON");
    }
    return actualizar(admin, id, body, perfil, correlacion);
  }

  return metodoNoPermitido();
});
