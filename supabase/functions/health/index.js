import { handleCors } from "../_shared/cors.js";
import { json } from "../_shared/response.js";

// Plantilla de referencia y verificación de salud del despliegue.
// Copiar esta estructura (index.js + imports de _shared) para cada función nueva.
Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } }, 405);
  }

  return json({
    status: "ok",
    service: "prestamos-multisucursal",
    timestamp: new Date().toISOString(),
  });
});
