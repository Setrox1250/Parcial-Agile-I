// HU-04: validación de la consulta de elegibilidad y cupo global (CA-26).
// Cualquier rol activo puede consultar (HU-01); los bloqueos detallados son
// BLOQUEADO_INCIDENCIA_IDENTIDAD (RN-05), MOROSO y EXTRAJUDICIAL (RN-15).
import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";
import { extraerIdPrestatario, esUuid, parseMonto } from "./validar.js";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return errorResponse("Use GET", 405, "METHOD_NOT_ALLOWED");
  }

  const { error: errorAuth } = await requireAuth(req);
  if (errorAuth) return errorAuth;

  const { pathname, searchParams } = new URL(req.url);
  const id = extraerIdPrestatario(pathname);
  if (!esUuid(id)) {
    return errorResponse(
      "Ruta inválida: use GET /elegibilidad/<uuid_prestatario>",
      400,
      "VALIDATION_ERROR",
    );
  }

  const { monto, error: errorMonto } = parseMonto(searchParams);
  if (errorMonto) return errorResponse(errorMonto, 400, "VALIDATION_ERROR");

  const admin = createAdminClient();
  const [respuesta, prestamos] = await Promise.all([
    admin.rpc("evaluar_elegibilidad", {
      p_prestatario_id: id,
      p_monto: monto,
    }),
    // Desglose por préstamo con sede de origen (CA-26, pantalla HU-04 4.5.2).
    admin
      .from("prestamos")
      .select(
        "id, estado, capital_insoluto, reserva_capital, creado_en, sucursales(nombre)",
      )
      .eq("prestatario_id", id)
      .in("estado", ["ACTIVO", "PENDIENTE_DESEMBOLSO"])
      .order("creado_en", { ascending: false }),
  ]);

  const { data, error } = respuesta;
  if (error || prestamos.error) {
    return errorResponse("No se pudo evaluar la elegibilidad", 500, "INTERNAL_ERROR");
  }
  if (!data?.existe) {
    return errorResponse("Prestatario no encontrado", 404, "NOT_FOUND");
  }
  return json({
    elegibilidad: {
      ...data,
      prestamos: (prestamos.data ?? []).map((p) => ({
        id: p.id,
        estado: p.estado,
        sucursal: p.sucursales?.nombre ?? null,
        capitalInsoluto: p.capital_insoluto,
        reservaCapital: p.reserva_capital,
        creadoEn: p.creado_en,
      })),
    },
  });
});
