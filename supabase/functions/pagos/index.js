// HU-07: cobranza (registro de pagos y verificación de transferencias).
//
// Rutas:
//   GET   /pagos             -> préstamos ACTIVOS de la sucursal de la sesión
//                               (para originar el cobro) + pagos recientes y
//                               transferencias pendientes de verificación.
//   POST  /pagos             -> registra el cobro (CA-18); el efectivo queda
//                               CONFIRMADO y la transferencia
//                               PENDIENTE_VERIFICACION (RN-23, §4.3.5).
//   GET   /pagos/<uuid>      -> detalle de un pago con su préstamo.
//   PATCH /pagos/<uuid>      -> { accion: CONFIRMAR | RECHAZAR } verificación
//                               manual del abono (§4.3.5).
//
// GET devuelve cuotas y saldos calculados con imputaciones CONFIRMADAS. Las
// transferencias PENDIENTE_VERIFICACION no reducen el saldo hasta confirmarse.
//
// RN-30: la sucursal se deriva de la sesión; un préstamo ajeno se rechaza.
import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole, assertSucursalPropia } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";
import { auditar, obtenerCorrelacion } from "../_shared/auditoria.js";
import { esUuid, extraerIdPago, parseRegistro, parseVerificacion } from "./validar.js";

const ROLES = ["ADMIN", "SUPERVISOR_FINANCIERO"];

const SELECT_PRESTAMO_ACTIVO =
  "id, prestatario_id, sucursal_id, principal, capital_insoluto, plazo_meses, estado, creado_en, desembolsado_en, " +
  "prestatarios!inner(tipo, personas_naturales(dni, nombres, apellido_paterno, " +
  "apellido_materno), empresas(ruc, razon_social)), sucursales(nombre)";

const SELECT_PAGO =
  "id, prestamo_id, monto, medio, referencia, estado, registra, confirma, " +
  "registrado_en, confirmado_en, imputado_en, " +
  "prestamos!inner(sucursal_id, prestatario_id, sucursales(nombre))";

function etiquetaFicha(ficha) {
  if (!ficha) return { tipo: null, documento: null, nombre: null };
  if (ficha.tipo === "EMPRESA") {
    return {
      tipo: "EMPRESA",
      documento: ficha.empresas?.ruc ?? null,
      nombre: ficha.empresas?.razon_social ?? null,
    };
  }
  const pn = ficha.personas_naturales;
  return pn
    ? {
        tipo: "PERSONA_NATURAL",
        documento: pn.dni,
        nombre: `${pn.nombres} ${pn.apellido_paterno} ${pn.apellido_materno}`.trim(),
      }
    : { tipo: "PERSONA_NATURAL", documento: null, nombre: null };
}

function formatearPrestamo(p) {
  return {
    id: p.id,
    principal: p.principal,
    capitalInsoluto: p.capital_insoluto,
    plazoMeses: p.plazo_meses,
    estado: p.estado,
    sucursal: p.sucursales?.nombre ?? null,
    creadoEn: p.creado_en,
    desembolsadoEn: p.desembolsado_en,
    prestatario: etiquetaFicha(p.prestatarios),
  };
}

function formatearPago(p, mapaFichas) {
  return {
    id: p.id,
    prestamoId: p.prestamo_id,
    monto: p.monto,
    medio: p.medio,
    referencia: p.referencia,
    estado: p.estado,
    registradoEn: p.registrado_en,
    confirmadoEn: p.confirmado_en,
    imputadoEn: p.imputado_en,
    sucursal: p.prestamos?.sucursales?.nombre ?? null,
    prestatario: mapaFichas.get(p.prestamos?.prestatario_id) ?? null,
  };
}

// Identidad de los prestatarios involucrados en los pagos (CA-26/§5).
async function cargarFichas(admin, prestatarioIds) {
  if (prestatarioIds.length === 0) return new Map();
  const { data, error } = await admin
    .from("prestatarios")
    .select(
      "id, tipo, personas_naturales(dni, nombres, apellido_paterno, apellido_materno), " +
        "empresas(ruc, razon_social)",
    )
    .in("id", prestatarioIds);
  if (error) throw new Error("fichas");
  return new Map(data.map((f) => [f.id, etiquetaFicha(f)]));
}

async function listar(admin, perfil) {
  const esAdmin = perfil.rol === "ADMIN";
  if (!esAdmin && !perfil.sucursal_id) {
    return errorResponse("La sesión no tiene sucursal asignada", 403, "FORBIDDEN_BRANCH");
  }

  try {
    let activos = admin
      .from("prestamos")
      .select(SELECT_PRESTAMO_ACTIVO)
      .eq("estado", "ACTIVO")
      .order("creado_en", { ascending: false })
      .limit(50);
    let pagos = admin
      .from("pagos")
      .select(SELECT_PAGO)
      .order("registrado_en", { ascending: false })
      .limit(50);
    if (!esAdmin) {
      activos = activos.eq("sucursal_id", perfil.sucursal_id);
      pagos = pagos.eq("prestamos.sucursal_id", perfil.sucursal_id);
    }

    const [listaActivos, listaPagos] = await Promise.all([activos, pagos]);
    if (listaActivos.error || listaPagos.error) throw new Error("consulta");

    const prestamosActivos = listaActivos.data ?? [];
    const idsPrestamos = prestamosActivos.map((p) => p.id);
    const cuotasRes = idsPrestamos.length === 0
      ? { data: [], error: null }
      : await admin
          .from("cuotas")
          .select("id, prestamo_id, numero, vencimiento, total_programado, estado")
          .in("prestamo_id", idsPrestamos)
          .order("numero");
    if (cuotasRes.error) throw new Error("cuotas");

    const cuotas = cuotasRes.data ?? [];
    const idsCuotas = cuotas.map((c) => c.id);
    const totalesRes = idsCuotas.length === 0
      ? { data: [], error: null }
      : await admin
          .from("cuotas_totales_imputados")
          .select("cuota_id, total_abonado")
          .in("cuota_id", idsCuotas);
    if (totalesRes.error) throw new Error("saldos de cuotas");

    const abonadoPorCuota = new Map(
      (totalesRes.data ?? []).map((t) => [t.cuota_id, Number(t.total_abonado)]),
    );
    const cuotasPorPrestamo = new Map();
    const hoyLima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
    for (const c of cuotas) {
      const abonado = abonadoPorCuota.get(c.id) ?? 0;
      const saldo = Math.max(0, Math.round((Number(c.total_programado) - abonado) * 100) / 100);
      const estado = saldo <= 0.005
        ? "PAGADA"
        : c.vencimiento < hoyLima
        ? "VENCIDA"
        : abonado > 0
        ? "PARCIAL"
        : "PENDIENTE";
      if (!cuotasPorPrestamo.has(c.prestamo_id)) cuotasPorPrestamo.set(c.prestamo_id, []);
      cuotasPorPrestamo.get(c.prestamo_id).push({
        numero: c.numero,
        vencimiento: c.vencimiento,
        montoProgramado: Number(c.total_programado),
        montoAbonado: Math.round(abonado * 100) / 100,
        saldo,
        estado,
      });
    }

    const fichas = await cargarFichas(
      admin,
      [...new Set((listaPagos.data ?? []).map((p) => p.prestamos?.prestatario_id).filter(Boolean))],
    );

    const pagosFormateados = (listaPagos.data ?? []).map((p) => formatearPago(p, fichas));
    return json({
      prestamos: prestamosActivos.map((p) => ({
        ...formatearPrestamo(p),
        cuotas: cuotasPorPrestamo.get(p.id) ?? [],
      })),
      pendientes: pagosFormateados.filter((p) => p.estado === "PENDIENTE_VERIFICACION"),
      recientes: pagosFormateados.filter((p) => p.estado !== "PENDIENTE_VERIFICACION"),
    });
  } catch {
    return errorResponse("No se pudo listar la cobranza", 500, "INTERNAL_ERROR");
  }
}

// Carga el pago con su identidad; devuelve { data } o { response } con el fallo.
async function leerDetalle(admin, perfil, pagoId) {
  const { data: pago, error } = await admin
    .from("pagos")
    .select(SELECT_PAGO)
    .eq("id", pagoId)
    .maybeSingle();
  if (error) return { response: errorResponse("No se pudo leer el pago", 500, "INTERNAL_ERROR") };
  if (!pago) return { response: errorResponse("Pago no encontrado", 404, "PAGO_INEXISTENTE") };

  const errorSucursal = assertSucursalPropia(perfil, pago.prestamos?.sucursal_id);
  if (errorSucursal) return { response: errorSucursal };

  try {
    const fichas = await cargarFichas(admin, [pago.prestamos?.prestatario_id].filter(Boolean));
    return { data: { pago: formatearPago(pago, fichas) } };
  } catch {
    return { response: errorResponse("No se pudo leer el pago", 500, "INTERNAL_ERROR") };
  }
}

async function detalle(admin, perfil, pagoId) {
  const leido = await leerDetalle(admin, perfil, pagoId);
  return leido.response ?? json(leido.data);
}

async function registrar(admin, perfil, body, correlacion) {
  const { prestamoId, monto, medio, referencia, idempotencyKey, error } = parseRegistro(body);
  if (error) return errorResponse(error, 400, "VALIDATION_ERROR");

  const { data: prestamo, error: errorLectura } = await admin
    .from("prestamos")
    .select("id, sucursal_id, estado")
    .eq("id", prestamoId)
    .maybeSingle();
  if (errorLectura) return errorResponse("No se pudo leer el préstamo", 500, "INTERNAL_ERROR");
  if (!prestamo) return errorResponse("Préstamo no encontrado", 404, "PRESTAMO_INEXISTENTE");

  const errorSucursal = assertSucursalPropia(perfil, prestamo.sucursal_id);
  if (errorSucursal) return errorSucursal;

  const { data, error: rpcError } = await admin.rpc("registrar_pago", {
    p_prestamo_id: prestamoId,
    p_monto: monto,
    p_medio: medio,
    p_referencia: referencia,
    p_registra: perfil.auth_user_id,
    p_idempotency_key: idempotencyKey,
  });
  if (rpcError || !data) {
    return errorResponse("No se pudo registrar el cobro", 500, "INTERNAL_ERROR");
  }
  if (!data.ok) {
    if (data.motivo === "PRESTAMO_INEXISTENTE") {
      return errorResponse("Préstamo no encontrado", 404, "PRESTAMO_INEXISTENTE");
    }
    if (data.motivo === "PRESTAMO_NO_ACTIVO") {
      return errorResponse(
        "Solo se registran cobros sobre un préstamo desembolsado (ACTIVO)",
        409,
        "PRESTAMO_NO_ACTIVO",
        { estado: data.estado_prestamo ?? null },
      );
    }
    return errorResponse(
      data.motivo === "MONTO_INVALIDO" ? "Monto inválido: debe ser mayor que cero" : "Cobro inválido",
      400,
      data.motivo ?? "VALIDATION_ERROR",
    );
  }

  const leido = await leerDetalle(admin, perfil, data.pago_id);
  if (leido.response) return leido.response;
  await auditar(admin, {
    perfil, correlacion, accion: "CREAR", entidad: "pagos", entidadId: data.pago_id,
    metadatos: { idempotente: data.idempotente === true, idempotency_key: idempotencyKey },
  });
  return json({ ...leido.data, idempotente: data.idempotente === true }, data.idempotente ? 200 : 201);
}

async function verificar(admin, perfil, pagoId, body, correlacion) {
  const { accion, motivo, error } = parseVerificacion(body);
  if (error) return errorResponse(error, 400, "VALIDATION_ERROR");

  const { data: pago, error: errorLectura } = await admin
    .from("pagos")
    .select("id, estado, prestamos!inner(sucursal_id)")
    .eq("id", pagoId)
    .maybeSingle();
  if (errorLectura) return errorResponse("No se pudo leer el pago", 500, "INTERNAL_ERROR");
  if (!pago) return errorResponse("Pago no encontrado", 404, "PAGO_INEXISTENTE");

  const errorSucursal = assertSucursalPropia(perfil, pago.prestamos?.sucursal_id);
  if (errorSucursal) return errorSucursal;

  if (accion === "REVERSAR") {
    if (perfil.rol !== "ADMIN") {
      return errorResponse("Solo ADMIN puede reversar un pago", 403, "FORBIDDEN_ROLE");
    }
    const { data, error: rpcError } = await admin.rpc("revertir_pago_confirmado", {
      p_pago_id: pagoId, p_motivo: motivo, p_actor: perfil.auth_user_id,
    });
    if (rpcError || !data) return errorResponse("No se pudo reversar el cobro", 500, "INTERNAL_ERROR");
    if (!data.ok) return errorResponse("No se puede reversar este pago", 409, data.motivo ?? "REVERSO_INVALIDO");
    await auditar(admin, {
      perfil, correlacion, accion: "REVERSAR", entidad: "pagos", entidadId: pagoId,
      metadatos: { motivo, reversion_id: data.reversion_id ?? null },
    });
    return detalle(admin, perfil, pagoId);
  }

  const { data, error: rpcError } = await admin.rpc("verificar_pago", {
    p_pago_id: pagoId,
    p_accion: accion,
    p_confirma: perfil.auth_user_id,
  });
  if (rpcError || !data) {
    return errorResponse("No se pudo verificar el cobro", 500, "INTERNAL_ERROR");
  }
  if (!data.ok) {
    if (data.motivo === "PAGO_INEXISTENTE") {
      return errorResponse("Pago no encontrado", 404, "PAGO_INEXISTENTE");
    }
    if (data.motivo === "ESTADO_NO_VERIFICABLE") {
      return errorResponse(
        "Solo se verifica una transferencia pendiente de verificación",
        409,
        "ESTADO_NO_VERIFICABLE",
        { estado: data.estado ?? null },
      );
    }
    return errorResponse("Acción inválida", 400, "ACCION_INVALIDA");
  }

  await auditar(admin, {
    perfil, correlacion, accion: "ACTUALIZAR", entidad: "pagos", entidadId: pagoId,
    metadatos: { operacion: accion },
  });

  return detalle(admin, perfil, pagoId);
}

function metodoNoPermitido() {
  return errorResponse("Use GET, POST o PATCH", 405, "METHOD_NOT_ALLOWED");
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const { perfil, error: errorAuth } = await requireAuth(req);
  if (errorAuth) return errorAuth;

  const errorRol = requireRole(perfil, ROLES);
  if (errorRol) return errorRol;
  const correlacion = obtenerCorrelacion(req);

  const { pathname } = new URL(req.url);
  const pagoId = extraerIdPago(pathname);
  if (pagoId === null) {
    return errorResponse("Ruta inválida: use /pagos o /pagos/<uuid>", 400, "VALIDATION_ERROR");
  }
  if (pagoId && !esUuid(pagoId)) {
    return errorResponse("Identificador de pago inválido", 400, "VALIDATION_ERROR");
  }

  const admin = createAdminClient();

  if (req.method === "GET") {
    return pagoId ? detalle(admin, perfil, pagoId) : listar(admin, perfil);
  }

  if (req.method === "POST") {
    if (pagoId) return metodoNoPermitido();
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Cuerpo JSON inválido", 400, "INVALID_JSON");
    }
    return registrar(admin, perfil, body, correlacion);
  }

  if (req.method === "PATCH") {
    if (!pagoId) {
      return errorResponse("Indique el id del pago a verificar", 400, "VALIDATION_ERROR");
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Cuerpo JSON inválido", 400, "INVALID_JSON");
    }
    return verificar(admin, perfil, pagoId, body, correlacion);
  }

  return metodoNoPermitido();
});
