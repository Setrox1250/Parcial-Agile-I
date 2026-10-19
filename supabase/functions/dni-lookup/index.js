import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";

// HU-02 — Identidad de prestatarios naturales.
// RN-01..RN-05 / CA-04..CA-06: DNI 8 dígitos, consulta real a Scrall
// (reniec_basico), mayoría de edad con America/Lima, ficha global única
// y discrepancia de nombre bloqueada con incidencia de auditoría.
//
// Secrets: SCRALL_API_KEY (plan API Básico, Authorization: Basic <clave>).

const SCRALL_URL = "https://api.scrall.net/v1/reniec/basico";
const SCRALL_TIMEOUT_MS = 8000;

// Plan gratuito: 2 peticiones cada 10 segundos (ventana por instancia; best effort).
const VENTANA_MS = 10_000;
const MAX_POR_VENTANA = 2;
const marcasDeConsulta = [];

const ROLES_PERMITIDOS = ["ADMIN", "SUPERVISOR_FINANCIERO"];

function excedeLimiteScrall() {
  const ahora = Date.now();
  while (marcasDeConsulta.length > 0 && ahora - marcasDeConsulta[0] >= VENTANA_MS) {
    marcasDeConsulta.shift();
  }
  if (marcasDeConsulta.length >= MAX_POR_VENTANA) return true;
  marcasDeConsulta.push(ahora);
  return false;
}

// Normaliza para comparar nombres (RN-05): sin acentos, espacios simples, mayúsculas.
function normalizarNombre(texto) {
  return String(texto ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// El proveedor real entrega los campos como columnas RENIEC (D_NUDNI, D_PRENOMBRES,
// ...); el blog documenta alias camelCase (nuDni, preNombres, ...). Se aceptan ambos.
function primerValor(registro, claves) {
  for (const clave of claves) {
    const valor = registro?.[clave];
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
      return String(valor).trim();
    }
  }
  return "";
}

// Acepta YYYY-MM-DD (con o sin hora), DD/MM/YYYY y DD-MM-YYYY -> YYYY-MM-DD.
function normalizarFecha(valor) {
  const texto = String(valor ?? "").trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const latina = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (latina) {
    const [, dia, mes, anio] = latina;
    return `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }
  return "";
}

// Edad en calendario según la fecha actual de Lima (spec §3.1).
function edadEnLima(fechaNacimiento) {
  const hoyLima = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
  const [anioHoy, mesHoy, diaHoy] = hoyLima.split("-").map(Number);
  const [anioNac, mesNac, diaNac] = fechaNacimiento.split("-").map(Number);
  let edad = anioHoy - anioNac;
  if (mesHoy < mesNac || (mesHoy === mesNac && diaHoy < diaNac)) edad -= 1;
  return edad;
}

// Mapea los mensajes de Scrall (HTTP 200 con message) a errores tipificados.
function errorDeMensajeScrall(mensaje) {
  const texto = String(mensaje ?? "").toLowerCase();
  if (texto.includes("not found data")) {
    return errorResponse("El DNI no fue encontrado en RENIEC", 404, "DNI_NO_ENCONTRADO");
  }
  if (texto.includes("not authorized") || texto.includes("plan not allowed")) {
    return errorResponse(
      "El endpoint no está habilitado en la clave del proveedor",
      502,
      "PROVEEDOR_ERROR",
    );
  }
  if (texto.includes("key deactivated")) {
    return errorResponse("Clave del proveedor desactivada", 502, "PROVEEDOR_ERROR");
  }
  if (texto.includes("enough queries")) {
    return errorResponse("El proveedor no tiene créditos disponibles", 502, "PROVEEDOR_ERROR");
  }
  if (
    texto.includes("unverified user") ||
    texto.includes("banned user") ||
    texto.includes("internal error")
  ) {
    return errorResponse("Cuenta del proveedor no habilitada o error interno", 502, "PROVEEDOR_ERROR");
  }
  return errorResponse("Respuesta no reconocida del proveedor", 502, "PROVEEDOR_ERROR");
}

async function consultarScrall(dni) {
  const clave = Deno.env.get("SCRALL_API_KEY");
  if (!clave) {
    return { respuesta: null, error: errorResponse("SCRALL_API_KEY no configurada", 500, "PROVEEDOR_ERROR") };
  }

  let respuesta;
  try {
    respuesta = await fetch(SCRALL_URL, {
      method: "POST",
      headers: {
        // La clave viaja tal cual, sin codificar (documentación de Scrall).
        Authorization: `Basic ${clave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ dni }),
      signal: AbortSignal.timeout(SCRALL_TIMEOUT_MS),
    });
  } catch {
    return {
      respuesta: null,
      error: errorResponse("El proveedor de identidad no responde", 502, "FALLO_RED"),
    };
  }

  if (respuesta.status === 429) {
    const texto = await respuesta.text().catch(() => "");
    const segundos = texto.match(/try again in (\d+) seconds/i)?.[1];
    return {
      respuesta: null,
      error: errorResponse(
        segundos
          ? `Límite de consultas del proveedor. Reintente en ${segundos} segundos`
          : "Límite de consultas del proveedor. Reintente en unos segundos",
        429,
        "RATE_LIMIT",
      ),
    };
  }
  if (respuesta.status === 401) {
    return {
      respuesta: null,
      error: errorResponse("Clave del proveedor inválida", 502, "PROVEEDOR_ERROR"),
    };
  }
  if (!respuesta.ok) {
    return {
      respuesta: null,
      error: errorResponse("El proveedor de identidad devolvió un error", 502, "PROVEEDOR_ERROR"),
    };
  }

  const cuerpo = await respuesta.json().catch(() => null);
  if (!cuerpo || typeof cuerpo.message !== "string") {
    return {
      respuesta: null,
      error: errorResponse("Respuesta inválida del proveedor", 502, "PROVEEDOR_ERROR"),
    };
  }
  return { respuesta: cuerpo, error: null };
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse("Use POST", 405, "METHOD_NOT_ALLOWED");
  }

  // CA-01: identidad de sesión y rol derivados del backend, nunca del body.
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const rolError = requireRole(auth.perfil, ROLES_PERMITIDOS);
  if (rolError) return rolError;

  let cuerpo = null;
  try {
    cuerpo = await req.json();
  } catch {
    return errorResponse("Cuerpo JSON inválido", 400, "INVALID_JSON");
  }

  const dni = typeof cuerpo?.dni === "string" ? cuerpo.dni.trim() : "";
  if (!/^\d{8}$/.test(dni)) {
    return errorResponse("El DNI debe tener exactamente 8 dígitos numéricos", 400, "DNI_INVALIDO");
  }

  if (excedeLimiteScrall()) {
    return errorResponse("Demasiadas consultas seguidas. Espere 10 segundos", 429, "RATE_LIMIT");
  }

  const { respuesta, error: errorScrall } = await consultarScrall(dni);
  if (errorScrall) return errorScrall;

  if (respuesta.message === "not found data") {
    return errorResponse("El DNI no fue encontrado en RENIEC", 404, "DNI_NO_ENCONTRADO");
  }
  if (respuesta.message !== "found data") {
    return errorDeMensajeScrall(respuesta.message);
  }

  const registro = respuesta.result ?? {};

  // CA-04 / RN-03: nuDni coincidente y datos completos; si no, no hay originación.
  const dniDevuelto = primerValor(registro, ["nuDni", "D_NUDNI"]);
  if (dniDevuelto !== dni) {
    return errorResponse(
      "La respuesta del proveedor no coincide con el DNI consultado",
      502,
      "DNI_INCONSISTENTE",
      { dniConsultado: dni, dniDevuelto, camposRecibidos: Object.keys(registro).join(",") },
    );
  }

  const nombres = primerValor(registro, ["preNombres", "D_PRENOMBRES"]);
  const apellidoPaterno = primerValor(registro, ["apePaterno", "D_APEPATERNO"]);
  const apellidoMaterno = primerValor(registro, ["apeMaterno", "D_APEMATERNO"]);
  const fechaNacimiento = normalizarFecha(
    primerValor(registro, ["feNacimiento", "D_FENACIMIENTO"]),
  );

  if (!nombres || !apellidoPaterno || !apellidoMaterno) {
    return errorResponse("Datos incompletos devueltos por el proveedor", 502, "PROVEEDOR_ERROR");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento) ||
    Number.isNaN(Date.parse(`${fechaNacimiento}T00:00:00Z`))) {
    return errorResponse("Fecha de nacimiento inválida del proveedor", 502, "PROVEEDOR_ERROR");
  }

  // CA-04: mayoría de edad con America/Lima; menor => no hay originación.
  const edad = edadEnLima(fechaNacimiento);
  if (edad < 18) {
    return errorResponse("La persona es menor de 18 años y no puede ser prestatario", 422, "MENOR_EDAD");
  }

  const admin = createAdminClient();

  // Ficha única (CA-05 / RN-01): INSERT atómico; si ya existe, se reutiliza.
  const { data: insertado, error: errorInsert } = await admin
    .from("prestatarios")
    .insert({
      tipo_documento: "DNI",
      numero_documento: dni,
      nombres,
      apellido_paterno: apellidoPaterno,
      apellido_materno: apellidoMaterno,
      fecha_nacimiento: fechaNacimiento,
      creado_por: auth.user.id,
    })
    .select()
    .maybeSingle();

  if (errorInsert && errorInsert.code !== "23505") {
    console.error("dni-lookup: fallo al crear ficha", errorInsert.code);
    return errorResponse("No se pudo registrar la ficha del prestatario", 500, "DB_ERROR");
  }

  if (insertado) {
    return json({ data: armarRespuesta(insertado, "NUEVO", edad) });
  }

  // Ya existe la ficha: reutilizar o bloquear por discrepancia (RN-05).
  const { data: existente, error: errorLectura } = await admin
    .from("prestatarios")
    .select("*")
    .eq("tipo_documento", "DNI")
    .eq("numero_documento", dni)
    .single();

  if (errorLectura || !existente) {
    console.error("dni-lookup: fallo al leer ficha existente", errorLectura?.code);
    return errorResponse("No se pudo leer la ficha del prestatario", 500, "DB_ERROR");
  }

  const coincide =
    normalizarNombre(existente.nombres) === normalizarNombre(nombres) &&
    normalizarNombre(existente.apellido_paterno) === normalizarNombre(apellidoPaterno) &&
    normalizarNombre(existente.apellido_materno) === normalizarNombre(apellidoMaterno);

  if (coincide) {
    return json({ data: armarRespuesta(existente, "EXISTENTE", edadEnLima(existente.fecha_nacimiento)) });
  }

  // RN-05: bloquear originación y registrar incidencia con auditoría.
  const nombreRegistrado =
    `${existente.nombres} ${existente.apellido_paterno} ${existente.apellido_materno}`.trim();
  const nombreConsultado = `${nombres} ${apellidoPaterno} ${apellidoMaterno}`.trim();

  const { error: errorIncidencia } = await admin.from("prestatario_incidencias").insert({
    prestatario_id: existente.id,
    tipo: "DISCREPANCIA_NOMBRE",
    nombre_registrado: nombreRegistrado,
    nombre_consultado: nombreConsultado,
    detectado_por: auth.user.id,
  });
  if (errorIncidencia) {
    // Se bloquea igualmente; el fallo del registro no habilita originación.
    console.error("dni-lookup: fallo al registrar incidencia", errorIncidencia.code);
  }

  return errorResponse(
    "El nombre registrado difiere de la consulta. Originación bloqueada hasta corrección autorizada",
    409,
    "DISCREPANCIA_NOMBRE",
    { nombreRegistrado, nombreConsultado },
  );
});

// Contrato de respuesta alineado con frontend/src/services/dni.js.
function armarRespuesta(fila, estadoFicha, edad) {
  const apellidos = `${fila.apellido_paterno} ${fila.apellido_materno}`.trim();
  return {
    numeroDni: fila.numero_documento,
    nombres: fila.nombres,
    apellidos,
    nombreCompleto: `${fila.nombres} ${apellidos}`.trim(),
    fechaNacimiento: fila.fecha_nacimiento,
    edad,
    estadoFicha,
    // B-01: la caducidad no es verificable con Scrall Básico; jamás true sin evidencia.
    dniVigente: fila.dni_vigente ?? null,
  };
}
