// Pruebas unitarias de las utilidades de la EF de pagos (HU-07).
// Ejecutar: deno test --node-modules-dir=none supabase/functions/pagos/

import { esUuid, extraerIdPago, parseRegistro, parseVerificacion } from "./validar.js";

const UUID = "3f2c8a10-1111-4222-8333-444455556666";

Deno.test("esUuid acepta un uuid válido y rechaza texto libre", () => {
  if (!esUuid(UUID)) throw new Error("esperaba true para uuid válido");
  if (esUuid("no-es-uuid") || esUuid("") || esUuid(undefined)) {
    throw new Error("esperaba false para valores no uuid");
  }
});

Deno.test("extraerIdPago distingue lista y detalle", () => {
  if (extraerIdPago("/pagos") !== "") throw new Error("esperaba '' para la lista");
  if (extraerIdPago(`/functions/v1/pagos`) !== "") throw new Error("esperaba '' con prefijo del gateway");
  if (extraerIdPago(`/pagos/${UUID}`) !== UUID) throw new Error(`esperaba ${UUID}`);
  if (extraerIdPago(`/pagos/${UUID}/x`) !== null) throw new Error("esperaba null con segmentos de más");
  if (extraerIdPago("/desembolso") !== null) throw new Error("esperaba null para otra entidad");
});

Deno.test("parseRegistro acepta efectivo válido con dos decimales", () => {
  const r = parseRegistro({ prestamo_id: UUID, monto: 150.5, medio: "efectivo" });
  if (r.error !== null || r.monto !== 150.5 || r.medio !== "EFECTIVO" || r.referencia !== null) {
    throw new Error(`registro inesperado: ${JSON.stringify(r)}`);
  }
});

Deno.test("parseRegistro rechaza montos inválidos o con más de dos decimales", () => {
  if (parseRegistro({ prestamo_id: UUID, monto: 0, medio: "EFECTIVO" }).error === null) {
    throw new Error("esperaba error con monto 0 (CA-18)");
  }
  if (parseRegistro({ prestamo_id: UUID, monto: -10, medio: "EFECTIVO" }).error === null) {
    throw new Error("esperaba error con monto negativo");
  }
  if (parseRegistro({ prestamo_id: UUID, monto: 10.123, medio: "EFECTIVO" }).error === null) {
    throw new Error("esperaba error con tres decimales (PEN)");
  }
  if (parseRegistro({ prestamo_id: UUID, medio: "EFECTIVO" }).error === null) {
    throw new Error("esperaba error sin monto");
  }
});

Deno.test("parseRegistro exige prestamo_id y medio correctos", () => {
  if (parseRegistro({ monto: 10, medio: "EFECTIVO" }).error === null) {
    throw new Error("esperaba error sin prestamo_id");
  }
  if (parseRegistro({ prestamo_id: "x", monto: 10, medio: "EFECTIVO" }).error === null) {
    throw new Error("esperaba error con prestamo_id no uuid");
  }
  if (parseRegistro({ prestamo_id: UUID, monto: 10, medio: "CHEQUE" }).error === null) {
    throw new Error("esperaba error con medio desconocido");
  }
});

Deno.test("parseRegistro aplica las reglas de referencia por medio", () => {
  const ok = parseRegistro({ prestamo_id: UUID, monto: 20, medio: "TRANSFERENCIA", referencia: " CCI-9 " });
  if (ok.error !== null || ok.referencia !== "CCI-9") {
    throw new Error(`esperaba referencia normalizada: ${JSON.stringify(ok)}`);
  }
  if (parseRegistro({ prestamo_id: UUID, monto: 20, medio: "TRANSFERENCIA" }).error === null) {
    throw new Error("esperaba error sin referencia en transferencia");
  }
  if (parseRegistro({ prestamo_id: UUID, monto: 20, medio: "EFECTIVO", referencia: "X" }).error === null) {
    throw new Error("esperaba error con referencia en efectivo");
  }
});

Deno.test("parseRegistro conserva la idempotency_key opcional", () => {
  const con = parseRegistro({ prestamo_id: UUID, monto: 5, medio: "EFECTIVO", idempotency_key: "pago-1" });
  if (con.error !== null || con.idempotencyKey !== "pago-1") {
    throw new Error(`esperaba clave conservada: ${JSON.stringify(con)}`);
  }
  const sin = parseRegistro({ prestamo_id: UUID, monto: 5, medio: "EFECTIVO" });
  if (sin.error !== null || sin.idempotencyKey !== null) {
    throw new Error("esperaba clave opcional en null");
  }
  if (parseRegistro({ prestamo_id: UUID, monto: 5, medio: "EFECTIVO", idempotency_key: " " }).error === null) {
    throw new Error("esperaba error con clave vacía");
  }
});

Deno.test("parseVerificacion admite solo CONFIRMAR o RECHAZAR", () => {
  if (parseVerificacion({ accion: "confirmar" }).accion !== "CONFIRMAR") {
    throw new Error("esperaba CONFIRMAR normalizado");
  }
  if (parseVerificacion({ accion: "RECHAZAR" }).accion !== "RECHAZAR") {
    throw new Error("esperaba RECHAZAR");
  }
  if (parseVerificacion({ accion: "BORRAR" }).error === null) {
    throw new Error("esperaba error con acción desconocida");
  }
  if (parseVerificacion({}).error === null) {
    throw new Error("esperaba error sin acción");
  }
});
