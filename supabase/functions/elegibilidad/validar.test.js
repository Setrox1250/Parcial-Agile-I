// Pruebas unitarias de las utilidades de la EF de elegibilidad (HU-04).
// Ejecutar: deno test --node-modules-dir=none supabase/functions/elegibilidad/

import { esUuid, extraerIdPrestatario, parseMonto } from "./validar.js";

const UUID = "3f2c8a10-1111-4222-8333-444455556666";

Deno.test("esUuid acepta un uuid válido", () => {
  if (!esUuid(UUID)) throw new Error("esperaba true para uuid válido");
});

Deno.test("esUuid rechaza texto no uuid", () => {
  if (esUuid("no-es-uuid")) throw new Error("esperaba false para texto libre");
  if (esUuid("")) throw new Error("esperaba false para cadena vacía");
  if (esUuid(undefined)) throw new Error("esperaba false para undefined");
});

Deno.test("extraerIdPrestatario extrae el id de la ruta estándar", () => {
  const id = extraerIdPrestatario(`/elegibilidad/${UUID}`);
  if (id !== UUID) throw new Error(`esperaba ${UUID}, obtuve ${id}`);
});

Deno.test("extraerIdPrestatario tolera el prefijo /functions/v1 del gateway", () => {
  const id = extraerIdPrestatario(
    `/functions/v1/elegibilidad/${UUID}`,
  );
  if (id !== UUID) throw new Error(`esperaba ${UUID}, obtuve ${id}`);
});

Deno.test("extraerIdPrestatario rechaza rutas incompletas o ajenas", () => {
  if (extraerIdPrestatario("/elegibilidad") !== null) {
    throw new Error("esperaba null sin id de prestatario");
  }
  if (extraerIdPrestatario(`/elegibilidad/${UUID}/extra`) !== null) {
    throw new Error("esperaba null con ruta con segmentos de más");
  }
  if (extraerIdPrestatario(`/usuarios/${UUID}`) !== null) {
    throw new Error("esperaba null con ruta de otra entidad");
  }
  if (extraerIdPrestatario(`/prestatarios/${UUID}/elegibilidad`) !== null) {
    throw new Error("esperaba null con la ruta anidada antigua");
  }
});

Deno.test("parseMonto acepta ausente y numéricos", () => {
  const vacio = parseMonto(new URLSearchParams(""));
  if (vacio.monto !== null || vacio.error !== null) {
    throw new Error("sin monto -> { monto: null, error: null }");
  }
  const conMonto = parseMonto(new URLSearchParams("monto=1500.50"));
  if (conMonto.monto !== 1500.5 || conMonto.error !== null) {
    throw new Error(`esperaba 1500.5, obtuve ${conMonto.monto}`);
  }
});

Deno.test("parseMonto rechaza valores no numéricos", () => {
  const r = parseMonto(new URLSearchParams("monto=abc"));
  if (r.error === null) throw new Error("esperaba error para monto abc");
  if (r.monto !== null) throw new Error("esperaba monto null");
});
