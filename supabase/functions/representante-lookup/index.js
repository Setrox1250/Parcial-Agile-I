import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole } from "../_shared/auth.js";
import { esRucValido } from "../_shared/ruc.js";

const JSONPE_ENDPOINT = "https://api.json.pe/api/representante-legal";
const TIMEOUT_MS = 8000;
const ROLES_PERMITIDOS = ["ADMIN", "SUPERVISOR_FINANCIERO"];

function obtener(objeto, claves) {
  for (const clave of claves) {
    const valor = objeto?.[clave];
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
      return String(valor).trim();
    }
  }
  return null;
}

function normalizarRepresentante(respuesta) {
  const datos = respuesta?.data ?? respuesta;
  const lista = Array.isArray(datos) ? datos : datos?.representantes;
  const representante = Array.isArray(lista)
    ? lista[0]
    : datos?.representante_legal ?? datos?.representanteLegal ?? datos?.representante ?? datos;
  if (!representante || typeof representante !== "object") return null;

  const dni = obtener(representante, ["dni", "documento", "numero_documento", "numeroDocumento"]);
  const nombres = obtener(representante, [
    "nombre_completo", "nombreCompleto", "nombres_completos", "nombresCompletos", "nombres_apellidos", "nombres", "nombre",
  ]);
  if (!dni || !/^\d{8}$/.test(dni)) return null;

  return {
    dni,
    nombres,
    cargo: obtener(representante, ["cargo", "rol", "puesto"]),
    fechaNombramiento: obtener(representante, [
      "fecha_nombramiento", "fechaNombramiento", "fecha_designacion", "fechaDesignacion",
    ]),
    estadoCargo: obtener(representante, ["estado_cargo", "estadoCargo", "estado"]),
  };
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Use POST", 405, "METHOD_NOT_ALLOWED");

  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const rolError = requireRole(auth.perfil, ROLES_PERMITIDOS);
  if (rolError) return rolError;

  const cuerpo = await req.json().catch(() => null);
  const ruc = typeof cuerpo?.ruc === "string" ? cuerpo.ruc.trim() : "";
  if (!/^\d{11}$/.test(ruc) || !esRucValido(ruc)) {
    return errorResponse("El RUC debe tener 11 dígitos y ser válido.", 400, "RUC_INVALIDO");
  }
  if (!ruc.startsWith("20")) {
    return errorResponse("La búsqueda de representante legal está disponible para RUC de empresa.", 422, "RUC_NO_EMPRESA");
  }

  const token = Deno.env.get("JSONPE_API_TOKEN");
  if (!token) {
    return errorResponse("Falta configurar la consulta externa de representante legal.", 503, "SERVICIO_NO_CONFIGURADO");
  }

  let respuesta;
  try {
    respuesta = await fetch(JSONPE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ruc }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return errorResponse("El servicio de representante legal no responde.", 502, "FALLO_RED");
  }

  const cuerpoProveedor = await respuesta.json().catch(() => null);
  if (!respuesta.ok || cuerpoProveedor?.success === false) {
    const estado = respuesta.status === 429 ? 429 : 502;
    const codigo = respuesta.status === 429 ? "RATE_LIMIT_PROVEEDOR" : "PROVEEDOR_ERROR";
    return errorResponse("No se pudo consultar el representante legal en el proveedor.", estado, codigo);
  }

  const representante = normalizarRepresentante(cuerpoProveedor);
  if (!representante) {
    return errorResponse(
      "El proveedor no devolvió un DNI de representante legal utilizable.",
      404,
      "REPRESENTANTE_NO_ENCONTRADO",
    );
  }

  return json({ representante, proveedor: "JSON.pe" });
});
