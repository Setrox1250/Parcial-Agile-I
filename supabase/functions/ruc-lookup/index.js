import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";
import { dniDesdeRuc10, esRucValido } from "../_shared/ruc.js";

// HU-03 — Identidad de empresa peruana (RUC).
// CA-07: RUC válido y únicos; razón social + estado ACTIVO/HABIDO cotejados con
//        fuente SUNAT (agregador apisperu) y con su procedencia/fecha (RN-35).
// CA-08/B-07: sin representante comprobado NO se origina crédito empresarial;
//        un RUC activo no prueba poderes vigentes.
// CA-09/RN-36: la deuda/cupo es del prestatario (RUC); nunca se imputa al DNI
//        del representante.
//
// Secret: APISPERU_API_KEY (token de consulta RUC de dniruc.apisperu.com).

const APISPERU_BASE = "https://dniruc.apisperu.com/api/v1";
const APISPERU_TIMEOUT_MS = 8000;

// Límite local best-effort (el plan gratuito es acotado; la autoridad es el proveedor).
const VENTANA_MS = 10_000;
const MAX_POR_VENTANA = 3;
const marcasDeConsulta = [];

const ROLES_PERMITIDOS = ["ADMIN", "SUPERVISOR_FINANCIERO"];

// La correlación viaja a una columna UUID: se valida el formato para que un
// header corrupto no tumbe la traza de auditoría (RN-34).
function idCorrelacion(req) {
  const encabezado = req.headers.get("x-correlation-id") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(encabezado)
    ? encabezado
    : crypto.randomUUID();
}

function excedeLimite() {
  const ahora = Date.now();
  while (marcasDeConsulta.length > 0 && ahora - marcasDeConsulta[0] >= VENTANA_MS) {
    marcasDeConsulta.shift();
  }
  if (marcasDeConsulta.length >= MAX_POR_VENTANA) return true;
  marcasDeConsulta.push(ahora);
  return false;
}

function texto(datos, clave) {
  const valor = datos?.[clave];
  return valor === undefined || valor === null ? "" : String(valor).trim();
}

// Contrato verificado en vivo (no deducido del swagger). Un "no encontrado"
// llega como HTTP 200 con `success: false`; el token inválido, como HTTP 500 en
// texto plano; y sin token, HTTP 401. Por eso se mira `success`, no el status.
async function consultarApisperu(ruc) {
  const token = Deno.env.get("APISPERU_API_KEY");
  if (!token) {
    console.error("ruc-lookup: falta el secreto de configuración del proveedor");
    return { datos: null, error: errorResponse("Servicio de consulta no disponible", 502, "PROVEEDOR_ERROR") };
  }

  let respuesta;
  try {
    const url = `${APISPERU_BASE}/ruc/${ruc}?token=${encodeURIComponent(token)}`;
    respuesta = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(APISPERU_TIMEOUT_MS),
    });
  } catch {
    return { datos: null, error: errorResponse("El proveedor de RUC no responde", 502, "FALLO_RED") };
  }

  if (respuesta.status === 401) {
    return { datos: null, error: errorResponse("Token de consulta RUC no aceptado", 502, "PROVEEDOR_ERROR") };
  }
  if (respuesta.status >= 500) {
    // Incluye el 500 con "Ocurrió un Error" (token inválido) devuelto en texto plano.
    return { datos: null, error: errorResponse("El servicio de consulta RUC falló", 502, "PROVEEDOR_ERROR") };
  }
  if (respuesta.status !== 200) {
    return { datos: null, error: errorResponse(`El proveedor respondió ${respuesta.status}`, 502, "PROVEEDOR_ERROR") };
  }

  const datos = await respuesta.json().catch(() => null);
  return { datos, error: null };
}

function registrarValidacion(admin, { correlacion, actor, resultado, codigoError, mensaje, numero }) {
  return admin
    .from("validaciones_identidad")
    .insert({
      proveedor: "APISPERU",
      tipo_documento: "RUC",
      numero_documento: numero,
      resultado,
      correlacion,
      codigo_error: codigoError ?? null,
      mensaje: mensaje ? String(mensaje).slice(0, 300) : null,
      actor,
    })
    .then(({ error }) => {
      if (error) console.error("ruc-lookup: no se pudo registrar la validación", error.code);
    });
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse("Use POST", 405, "METHOD_NOT_ALLOWED");
  }

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

  const ruc = typeof cuerpo?.ruc === "string" ? cuerpo.ruc.trim() : "";
  const confirmar = cuerpo?.confirmar === true;
  if (!/^\d{11}$/.test(ruc)) {
    return errorResponse("El RUC debe tener exactamente 11 dígitos numéricos", 400, "RUC_INVALIDO");
  }
  // CA-07: valida el dígito verificador antes de gastar una consulta.
  if (!esRucValido(ruc)) {
    return errorResponse("El RUC no es válido (dígito verificador incorrecto)", 400, "RUC_INVALIDO");
  }

  let dniRepresentanteSolicitado = typeof cuerpo?.representanteDni === "string" ? cuerpo.representanteDni.trim() : "";
  if (dniRepresentanteSolicitado && !/^\d{8}$/.test(dniRepresentanteSolicitado)) {
    return errorResponse("El DNI del representante debe tener 8 dígitos", 400, "DNI_INVALIDO");
  }

  const admin = createAdminClient();
  const correlacion = idCorrelacion(req);
  const actor = auth.user.id;
  const traza = (resultado, codigoError, mensaje) =>
    registrarValidacion(admin, { correlacion, actor, resultado, codigoError, mensaje, numero: ruc });

  if (excedeLimite()) {
    await traza("RATE_LIMIT", "RATE_LIMIT", "Límite local de consultas");
    return errorResponse("Demasiadas consultas seguidas. Espere 10 segundos", 429, "RATE_LIMIT");
  }

  const { datos, error: errorProveedor } = await consultarApisperu(ruc);
  if (errorProveedor) {
    await traza("ERROR_PROVEEDOR", "PROVEEDOR_ERROR", "Fallo de red o del proveedor");
    return errorProveedor;
  }

  // El "no encontrado" llega como HTTP 200 con success:false (o sin razón social).
  const razonSocial = texto(datos, "razonSocial");
  if (datos?.success === false || !razonSocial) {
    await traza("NO_ENCONTRADO", "RUC_NO_ENCONTRADO", datos?.message ?? "Sin razón social");
    return errorResponse("El RUC no fue encontrado en la fuente de consulta", 404, "RUC_NO_ENCONTRADO");
  }

  // CA-07: solo se admite RUC ACTIVO y HABIDO; si no, se bloquea la originación.
  const estadoRuc = texto(datos, "estado").toUpperCase() || null;
  const condicionRuc = texto(datos, "condicion").toUpperCase() || null;
  if (estadoRuc !== "ACTIVO" || condicionRuc !== "HABIDO") {
    await traza("BLOQUEADO_ESTADO", "RUC_NO_HABIDO", `estado=${estadoRuc ?? "?"} condicion=${condicionRuc ?? "?"}`);
    return errorResponse(
      `El RUC no está ACTIVO y HABIDO (estado: ${estadoRuc ?? "desconocido"}, condición: ${condicionRuc ?? "desconocida"}). No se puede originar.`,
      422,
      "RUC_NO_HABIDO",
      { estado: estadoRuc, condicion: condicionRuc },
    );
  }

  // 3.4.2: la primera consulta solo muestra los datos cotejados. La ficha
  // global se crea/reutiliza después de la confirmación explícita del operador.
  if (!confirmar) {
    let representanteDniSugerido = dniRepresentanteSolicitado || null;
    let representanteRolSugerido = representanteDniSugerido ? "REPRESENTANTE_LEGAL" : null;
    const derivado = dniDesdeRuc10(ruc);
    if (!representanteDniSugerido && derivado) {
      representanteDniSugerido = derivado;
      representanteRolSugerido = "TITULAR";
    }
    await traza("ENCONTRADO", null, "found data; pendiente de confirmación");
    return json({
      data: {
        numeroRuc: ruc,
        razonSocial,
        estado: estadoRuc,
        condicion: condicionRuc,
        direccion: texto(datos, "direccion") || null,
        departamento: texto(datos, "departamento") || null,
        provincia: texto(datos, "provincia") || null,
        distrito: texto(datos, "distrito") || null,
        ubigeo: texto(datos, "ubigeo") || null,
        estadoFicha: "PENDIENTE_CONFIRMACION",
        prestatarioId: null,
        representanteDni: null,
        representanteRol: representanteRolSugerido,
        representanteDniSugerido,
        representanteEstado: representanteDniSugerido ? "REPRESENTANTE_NO_VALIDADO" : "SIN_REPRESENTANTE",
        requiereConfirmacion: true,
        avisoPoderes:
          "Un RUC ACTIVO/HABIDO no acredita por sí solo las facultades del representante (B-07).",
      },
    });
  }

  // Representante: RUC 10 embebe el DNI del titular; el resto lo recibe del formulario.
  let rol = "REPRESENTANTE_LEGAL";
  if (!dniRepresentanteSolicitado) {
    const derivado = dniDesdeRuc10(ruc);
    if (derivado) {
      dniRepresentanteSolicitado = derivado;
      rol = "TITULAR";
    }
  }

  const { data: filas, error: errorRpc } = await admin.rpc("registrar_empresa", {
    p_ruc: ruc,
    p_razon_social: razonSocial,
    p_estado_ruc: estadoRuc,
    p_condicion_ruc: condicionRuc,
    p_direccion: texto(datos, "direccion") || null,
    p_departamento: texto(datos, "departamento") || null,
    p_provincia: texto(datos, "provincia") || null,
    p_distrito: texto(datos, "distrito") || null,
    p_ubigeo: texto(datos, "ubigeo") || null,
    p_fuente: "APISPERU",
    p_actor: actor,
    p_representante_dni: dniRepresentanteSolicitado || null,
    p_representante_rol: dniRepresentanteSolicitado ? rol : null,
  });
  const ficha = Array.isArray(filas) ? filas[0] : filas;

  if (errorRpc || !ficha) {
    console.error("ruc-lookup: fallo al registrar la empresa", errorRpc?.code);
    await traza("ERROR_PROVEEDOR", "DB_ERROR", "No se pudo registrar la empresa");
    return errorResponse("No se pudo registrar la empresa", 500, "DB_ERROR");
  }

  // Al consultar de nuevo una empresa ya registrada, la RPC reutiliza la ficha
  // y no recibe necesariamente el DNI del representante. Se recupera el
  // vínculo persistido para que la pantalla pueda mostrar si ya fue acreditado
  // y permitir continuar con elegibilidad/originación sin repetir el flujo.
  let representanteEstado = ficha.representante_estado;
  let dniRepresentanteRespuesta =
    representanteEstado === "VINCULADO" ? dniRepresentanteSolicitado : null;
  let representanteRol = representanteEstado === "VINCULADO" ? rol : null;
  let representanteDniSugerido =
    representanteEstado === "REPRESENTANTE_NO_VALIDADO" ? dniRepresentanteSolicitado : null;

  if (representanteEstado === "YA_REGISTRADA") {
    const { data: vinculo, error: errorVinculo } = await admin
      .from("representantes_empresa")
      .select("persona_id, rol, autorizacion_comprobada")
      .eq("empresa_id", ficha.prestatario_id)
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errorVinculo) {
      console.error("ruc-lookup: no se pudo recuperar el representante", errorVinculo.code);
    } else if (vinculo) {
      const { data: persona, error: errorPersona } = await admin
        .from("personas_naturales")
        .select("dni")
        .eq("prestatario_id", vinculo.persona_id)
        .maybeSingle();
      if (errorPersona) {
        console.error("ruc-lookup: no se pudo recuperar el DNI del representante", errorPersona.code);
      } else {
        dniRepresentanteRespuesta = persona?.dni ?? null;
        representanteRol = vinculo.rol;
        representanteEstado = vinculo.autorizacion_comprobada ? "ACREDITADO" : "VINCULADO";
      }
    } else {
      representanteEstado = "SIN_REPRESENTANTE";
    }
  }

  await traza("ENCONTRADO", null, "found data");

  return json({
    data: {
      numeroRuc: ruc,
      razonSocial,
      estado: estadoRuc,
      condicion: condicionRuc,
      direccion: texto(datos, "direccion") || null,
      departamento: texto(datos, "departamento") || null,
      provincia: texto(datos, "provincia") || null,
      distrito: texto(datos, "distrito") || null,
      ubigeo: texto(datos, "ubigeo") || null,
      estadoFicha: ficha.creado ? "NUEVO" : "EXISTENTE",
      requiereConfirmacion: false,
      prestatarioId: ficha.prestatario_id,
      // Solo se declara representante vinculado cuando la RPC realmente lo vinculó;
      // el DNI derivado/pendiente se expone aparte para guiar la validación (HU-02).
      representanteDni: dniRepresentanteRespuesta,
      representanteRol,
      representanteDniSugerido:
        representanteDniSugerido,
      // VINCULADO | REPRESENTANTE_NO_VALIDADO | SIN_REPRESENTANTE | YA_REGISTRADA
      representanteEstado,
      // B-07: el RUC activo NO acredita poderes vigentes del representante.
      avisoPoderes:
        "Un RUC ACTIVO/HABIDO no acredita por sí solo las facultades del representante (B-07).",
    },
  });
});
