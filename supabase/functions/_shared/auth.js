import { createAdminClient, createAnonClient } from "./supabase.js";
import { errorResponse } from "./response.js";

// Valida el JWT de la cabecera Authorization y devuelve el usuario autenticado.
export async function getUser(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { user: null, error: errorResponse("Falta token de autenticación", 401, "UNAUTHORIZED") };
  }
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await createAnonClient().auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: errorResponse("Token inválido o expirado", 401, "UNAUTHORIZED") };
  }
  return { user: data.user, error: null };
}

// Devuelve el perfil controlado (rol, sucursal, activo) desde la BD, nunca desde el formulario.
export async function getPerfil(userId) {
  const { data, error } = await createAdminClient()
    .from("perfiles")
    .select("auth_user_id, nombre_visible, rol, sucursal_id, activo")
    .eq("auth_user_id", userId)
    .single();
  if (error || !data) {
    return { perfil: null, error: errorResponse("Perfil no encontrado", 403, "FORBIDDEN") };
  }
  if (!data.activo) {
    return { perfil: null, error: errorResponse("Usuario inactivo", 403, "INACTIVE_USER") };
  }
  return { perfil: data, error: null };
}

// Autenticación + perfil en un solo paso. Usa { user, perfil } o { error }.
export async function requireAuth(req) {
  const { user, error: userError } = await getUser(req);
  if (userError) return { user: null, perfil: null, error: userError };
  const { perfil, error: perfilError } = await getPerfil(user.id);
  if (perfilError) return { user: null, perfil: null, error: perfilError };
  return { user, perfil, error: null };
}

// Requiere que el rol del perfil esté en la lista permitida.
export function requireRole(perfil, roles) {
  if (!roles.includes(perfil.rol)) {
    return errorResponse("No tiene permisos para esta operación", 403, "FORBIDDEN_ROLE");
  }
  return null;
}

// RN-30: la sucursal del préstamo debe coincidir con la del perfil.
export function assertSucursalPropia(perfil, sucursalId) {
  if (perfil.rol !== "ADMIN" && perfil.sucursal_id !== sucursalId) {
    return errorResponse("Operación no permitida fuera de su sucursal", 403, "FORBIDDEN_BRANCH");
  }
  return null;
}
