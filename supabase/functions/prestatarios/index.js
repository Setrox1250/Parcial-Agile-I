// HU-09: consultas globales de prestatarios (CA-25..CA-27, RN-01/RN-16/17/28/36).
//   GET /prestatarios/buscar?dni=|ruc=      -> ficha única consolidada (9.1)
//   GET /prestatarios/<uuid>/historial      -> vista consolidada (9.2)
// Solo lectura (CA-27): no existen rutas de escritura ni borrado. Cualquier
// rol activo consulta la misma ficha global multisucursal (RN-36).
import { handleCors } from "../_shared/cors.js";
import { json, errorResponse } from "../_shared/response.js";
import { requireAuth, requireRole } from "../_shared/auth.js";
import { createAdminClient } from "../_shared/supabase.js";
import { parsearBusqueda, parsearRutaHistorial } from "./validar.js";

const IDENTIDAD_NATURAL =
  "prestatario_id, dni, nombres, apellido_paterno, apellido_materno";
const IDENTIDAD_EMPRESA = "prestatario_id, ruc, razon_social, estado_ruc";
// RN-36: ambos roles del MVP leen la misma ficha global multisucursal.
const ROLES = ["ADMIN", "SUPERVISOR_FINANCIERO"];

function identidadNatural(pn) {
  return {
    dni: pn.dni,
    nombres: pn.nombres,
    apellidoPaterno: pn.apellido_paterno,
    apellidoMaterno: pn.apellido_materno,
    nombreCompleto: `${pn.nombres} ${pn.apellido_paterno} ${pn.apellido_materno}`.trim(),
  };
}

function identidadEmpresa(em) {
  return { ruc: em.ruc, razonSocial: em.razon_social, estadoRuc: em.estado_ruc };
}

// Busca la ficha por DNI (persona natural) o RUC (empresa); null si no existe.
async function buscarFicha(admin, tipo, valor) {
  if (tipo === "dni") {
    const { data, error } = await admin
      .from("personas_naturales")
      .select(IDENTIDAD_NATURAL)
      .eq("dni", valor)
      .maybeSingle();
    if (error || !data) return null;
    return { prestatarioId: data.prestatario_id, tipo: "PERSONA_NATURAL", identidad: identidadNatural(data) };
  }
  const { data, error } = await admin
    .from("empresas")
    .select(IDENTIDAD_EMPRESA)
    .eq("ruc", valor)
    .maybeSingle();
  if (error || !data) return null;
  return { prestatarioId: data.prestatario_id, tipo: "EMPRESA", identidad: identidadEmpresa(data) };
}

async function elegibilidadDe(admin, prestatarioId) {
  const { data, error } = await admin.rpc("evaluar_elegibilidad", {
    p_prestatario_id: prestatarioId,
    p_monto: null,
  });
  if (error || !data?.existe) return null;
  return data;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return errorResponse("Use GET", 405, "METHOD_NOT_ALLOWED");
  }

  const { perfil, error: errorAuth } = await requireAuth(req);
  if (errorAuth) return errorAuth;
  const errorRol = requireRole(perfil, ROLES);
  if (errorRol) return errorRol;

  const { pathname, searchParams } = new URL(req.url);
  const admin = createAdminClient();

  // ------------------------------------------------------------------ 9.1
  if (pathname.endsWith("/buscar")) {
    const { tipo, valor, error } = parsearBusqueda(searchParams);
    if (error) return errorResponse(error, 400, "VALIDATION_ERROR");

    const ficha = await buscarFicha(admin, tipo, valor);
    if (!ficha) {
      return errorResponse("No existe ficha para el documento consultado", 404, "NOT_FOUND");
    }
    const elegibilidad = await elegibilidadDe(admin, ficha.prestatarioId);
    if (!elegibilidad) {
      return errorResponse("No se pudo consolidar la ficha", 500, "INTERNAL_ERROR");
    }
    return json({
      resultado: {
        ...ficha,
        clasificacion: elegibilidad.clasificacion,
        bloqueos: elegibilidad.bloqueos,
        elegible: elegibilidad.elegible,
        motivo: elegibilidad.motivo,
      },
    });
  }

  // ------------------------------------------------------------------ 9.2
  const { prestatarioId, error: errorRuta } = parsearRutaHistorial(pathname);
  if (errorRuta) return errorResponse(errorRuta, 400, "VALIDATION_ERROR");

  const { data: prestatario, error: errorPrestatario } = await admin
    .from("prestatarios")
    .select("id, tipo, estado")
    .eq("id", prestatarioId)
    .maybeSingle();
  if (errorPrestatario) {
    return errorResponse("No se pudo leer la ficha", 500, "INTERNAL_ERROR");
  }
  if (!prestatario) {
    return errorResponse("Ficha no encontrada", 404, "NOT_FOUND");
  }

  let ficha;
  if (prestatario.tipo === "PERSONA_NATURAL") {
    const { data } = await admin
      .from("personas_naturales")
      .select(IDENTIDAD_NATURAL)
      .eq("prestatario_id", prestatarioId)
      .maybeSingle();
    ficha = data ? identidadNatural(data) : null;
  } else {
    const { data } = await admin
      .from("empresas")
      .select(IDENTIDAD_EMPRESA)
      .eq("prestatario_id", prestatarioId)
      .maybeSingle();
    ficha = data ? identidadEmpresa(data) : null;
  }

  const elegibilidad = await elegibilidadDe(admin, prestatarioId);
  if (!elegibilidad) {
    return errorResponse("No se pudo consolidar el historial", 500, "INTERNAL_ERROR");
  }

  const { data: prestamos, error: errorPrestamos } = await admin
    .from("prestamos")
    .select(
      "id, sucursal_id, principal, plazo_meses, tea, estado, fecha_originacion, creado_en, desembolsado_en, sucursales(nombre)",
    )
    .eq("prestatario_id", prestatarioId)
    .order("creado_en", { ascending: false })
    .limit(100);
  if (errorPrestamos) {
    return errorResponse("No se pudieron leer los préstamos", 500, "INTERNAL_ERROR");
  }
  const idsPrestamos = (prestamos ?? []).map((p) => p.id);

  const vacio = idsPrestamos.length === 0;
  const [cuotasRes, pagosRes, desembolsosRes, expedientesRes] = await Promise.all([
    vacio
      ? { data: [], error: null }
      : admin
          .from("cuotas")
          .select(
            "id, prestamo_id, numero, vencimiento, capital_programado, interes_programado, total_programado, estado",
          )
          .in("prestamo_id", idsPrestamos)
          .order("numero"),
    vacio
      ? { data: [], error: null }
      : admin
          .from("pagos")
          .select(
            "id, prestamo_id, monto, medio, referencia, estado, registrado_en, confirmado_en, imputado_en",
          )
          .in("prestamo_id", idsPrestamos)
          .order("registrado_en", { ascending: false })
          .limit(200),
    vacio
      ? { data: [], error: null }
      : admin
          .from("desembolsos")
          .select("prestamo_id, importe, metodo, referencia, fecha, confirmo")
          .in("prestamo_id", idsPrestamos),
    vacio
      ? { data: [], error: null }
      : admin
          .from("expdedientes_extrajudicial")
          .select(
            "id, prestamo_id, evento_mora_id, fecha_escalamiento, estado, responsable, accion, resultado, eventos_mora(inicio_mora)",
          )
          .in("prestamo_id", idsPrestamos)
          .order("fecha_escalamiento", { ascending: false }),
  ]);
  if (cuotasRes.error || pagosRes.error || desembolsosRes.error || expedientesRes.error) {
    return errorResponse("No se pudo consolidar el historial", 500, "INTERNAL_ERROR");
  }

  const idsCuotas = (cuotasRes.data ?? []).map((c) => c.id);
  const idsPagos = (pagosRes.data ?? []).map((p) => p.id);

  const [totalesRes, imputacionesRes, responsablesRes] = await Promise.all([
    idsCuotas.length === 0
      ? { data: [], error: null }
      : admin
          .from("cuotas_totales_imputados")
          .select("cuota_id, total_capital, total_interes, total_abonado")
          .in("cuota_id", idsCuotas),
    idsPagos.length === 0
      ? { data: [], error: null }
      : admin
          .from("pagos_imputaciones")
          .select("pago_id, cuota_id, importe_capital, importe_interes")
          .in("pago_id", idsPagos),
    (expedientesRes.data ?? []).filter((x) => x.responsable).length === 0
      ? { data: [], error: null }
      : admin
          .from("perfiles")
          .select("auth_user_id, nombre_visible")
          .in(
            "auth_user_id",
            [...new Set((expedientesRes.data ?? []).map((x) => x.responsable))],
          ),
  ]);
  if (totalesRes.error || imputacionesRes.error || responsablesRes.error) {
    return errorResponse("No se pudo consolidar el historial", 500, "INTERNAL_ERROR");
  }

  const porCuota = new Map((totalesRes.data ?? []).map((t) => [t.cuota_id, t]));
  const porPago = new Map();
  for (const imp of imputacionesRes.data ?? []) {
    if (!porPago.has(imp.pago_id)) porPago.set(imp.pago_id, []);
    porPago.get(imp.pago_id).push({
      cuotaId: imp.cuota_id,
      capital: imp.importe_capital,
      interes: imp.importe_interes,
    });
  }
  const porPrestamo = (coleccion, campo) => {
    const mapa = new Map();
    for (const item of coleccion) {
      const clave = item[campo];
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push(item);
    }
    return mapa;
  };
  const cuotasPorPrestamo = porPrestamo(cuotasRes.data ?? [], "prestamo_id");
  const pagosPorPrestamo = porPrestamo(pagosRes.data ?? [], "prestamo_id");
  const desembolsosPorPrestamo = porPrestamo(desembolsosRes.data ?? [], "prestamo_id");
  const expedientesPorPrestamo = porPrestamo(expedientesRes.data ?? [], "prestamo_id");
  const nombresResponsable = new Map(
    (responsablesRes.data ?? []).map((r) => [r.auth_user_id, r.nombre_visible]),
  );

  const prestamosConsolidados = (prestamos ?? []).map((p) => ({
    id: p.id,
    sucursal: p.sucursales?.nombre ?? null,
    principal: p.principal,
    plazoMeses: p.plazo_meses,
    tea: p.tea,
    estado: p.estado,
    fechaOriginacion: p.fecha_originacion,
    creadoEn: p.creado_en,
    desembolsadoEn: p.desembolsado_en,
    // Evidencia de desembolso (HU-06/CA-16), si se confirmó.
    desembolso: (() => {
      const d = (desembolsosPorPrestamo.get(p.id) ?? [])[0];
      return d
        ? { importe: d.importe, metodo: d.metodo, referencia: d.referencia, fecha: d.fecha }
        : null;
    })(),
    // 9.2.2: cronograma con saldos exactos derivados de imputaciones (CA-25).
    cuotas: (cuotasPorPrestamo.get(p.id) ?? []).map((c) => {
      const t = porCuota.get(c.id);
      const abonado = t ? Number(t.total_abonado) : 0;
      return {
        numero: c.numero,
        vencimiento: c.vencimiento,
        capitalProgramado: c.capital_programado,
        interesProgramado: c.interes_programado,
        totalProgramado: c.total_programado,
        estado: c.estado,
        capitalAbonado: t ? Number(t.total_capital) : 0,
        interesAbonado: t ? Number(t.total_interes) : 0,
        abonado,
        saldo: Math.round((Number(c.total_programado) - abonado) * 100) / 100,
      };
    }),
    // 9.2.3: pagos con imputaciones capital/interés (RN-33: histórico inmutable).
    pagos: (pagosPorPrestamo.get(p.id) ?? []).map((pg) => ({
      id: pg.id,
      monto: pg.monto,
      medio: pg.medio,
      referencia: pg.referencia,
      estado: pg.estado,
      registradoEn: pg.registrado_en,
      confirmadoEn: pg.confirmado_en,
      imputadoEn: pg.imputado_en,
      imputaciones: porPago.get(pg.id) ?? [],
    })),
  }));

  return json({
    historial: {
      prestatario: {
        id: prestatario.id,
        tipo: prestatario.tipo,
        estadoFicha: prestatario.estado,
        identidad: ficha,
      },
      // 9.2.4: cupo global y motivo de bloqueo (HU-04).
      elegibilidad: {
        clasificacion: elegibilidad.clasificacion,
        bloqueos: elegibilidad.bloqueos,
        limite: elegibilidad.limite,
        ocupado: elegibilidad.ocupado,
        disponible: elegibilidad.disponible,
        elegible: elegibilidad.elegible,
        motivo: elegibilidad.motivo,
      },
      prestamos: prestamosConsolidados,
      // 9.2.5: expedientes inmutables (CA-27/RN-28), si existen.
      expedientes: (expedientesRes.data ?? []).map((x) => ({
        id: x.id,
        prestamoId: x.prestamo_id,
        inicioMora: x.eventos_mora?.inicio_mora ?? null,
        fechaEscalamiento: x.fecha_escalamiento,
        estado: x.estado,
        responsable: x.responsable ? nombresResponsable.get(x.responsable) ?? x.responsable : null,
        accion: x.accion,
        resultado: x.resultado,
      })),
    },
  });
});
