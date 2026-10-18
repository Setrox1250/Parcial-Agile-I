import { handleCors } from "../_shared/cors.js";
import { json } from "../_shared/response.js";
import { requireAuth } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";

// Devuelve el perfil controlado del usuario autenticado (rol, sucursal, estado).
// Fuente: BD, nunca el formulario del cliente (CA-01).
Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } }, 405);
  }

  const { user, perfil, error } = await requireAuth(req);
  if (error) return error;
  if (!perfil.sucursal_id) {
    return json({
      usuario: {
        auth_user_id: user.id,
        nombre_visible: perfil.nombre_visible,
        rol: perfil.rol,
        sucursal_id: null,
        sucursal_nombre: null,
        activo: perfil.activo,
      },
    });
  }

  const { data: sucursal, error: sucursalError } = await createAdminClient()
    .from("sucursales")
    .select("nombre")
    .eq("id", perfil.sucursal_id)
    .single();

  return json({
    usuario: {
      auth_user_id: user.id,
      nombre_visible: perfil.nombre_visible,
      rol: perfil.rol,
      sucursal_id: perfil.sucursal_id,
      sucursal_nombre: sucursalError ? null : sucursal.nombre,
      activo: perfil.activo,
    },
  });
});
