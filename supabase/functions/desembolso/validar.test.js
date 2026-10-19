// Pruebas unitarias de las utilidades de la EF de desembolso (HU-06).
// Ejecutar: deno test --node-modules-dir=none supabase/functions/desembolso/

import { esUuid, extraerIdPrestamo, parseConfirmacion } from "./validar.js";

const UUID = "3f2c8a10-1111-4222-8333-444455556666";

Deno.test("esUuid acepta un uuid válido y rechaza texto libre", () => {
  if (!esUuid(UUID)) throw new Error("esperaba true para uuid válido");
  if (esUuid("no-es-uuid") || esUuid("") || esUuid(undefined)) {
    throw new Error("esperaba false para valores no uuid");
  }
});

Deno.test("extraerIdPrestamo extrae el id de la ruta estándar", () => {
  const id = extraerIdPrestamo(`/desembolso/${UUID}`);
  if (id !== UUID) throw new Error(`esperaba ${UUID}, obtuve ${id}`);
});

Deno.test("extraerIdPrestamo devuelve cadena vacía en la lista", () => {
  if (extraerIdPrestamo("/desembolso") !== "") {
    throw new Error("esperaba '' para la ruta de lista");
  }
  if (extraerIdPrestamo(`/functions/v1/desembolso`) !== "") {
    throw new Error("esperaba '' con el prefijo del gateway");
  }
});

Deno.test("extraerIdPrestamo rechaza rutas incompletas o ajenas", () => {
  if (extraerIdPrestamo(`/desembolso/${UUID}/extra`) !== null) {
    throw new Error("esperaba null con segmentos de más");
  }
  if (extraerIdPrestamo(`/desembolsos/${UUID}`) !== null) {
    throw new Error("esperaba null con ruta de otra entidad");
  }
  if (extraerIdPrestamo("/otra/funcion") !== null) {
    throw new Error("esperaba null sin segmento desembolso");
  }
});

Deno.test("parseConfirmacion acepta efectivo sin referencia", () => {
  const r = parseConfirmacion({ metodo: "efectivo" });
  if (r.error !== null || r.metodo !== "EFECTIVO" || r.referencia !== null) {
    throw new Error(`esperaba EFECTIVO sin referencia, obtuve ${JSON.stringify(r)}`);
  }
});

Deno.test("parseConfirmacion exige referencia en transferencia", () => {
  const ok = parseConfirmacion({ metodo: "TRANSFERENCIA", referencia: " 000123 " });
  if (ok.error !== null || ok.referencia !== "000123") {
    throw new Error(`esperaba referencia normalizada, obtuve ${JSON.stringify(ok)}`);
  }
  const mal = parseConfirmacion({ metodo: "TRANSFERENCIA" });
  if (mal.error === null) throw new Error("esperaba error sin referencia");
});

Deno.test("parseConfirmacion rechaza referencia en efectivo y métodos desconocidos", () => {
  if (parseConfirmacion({ metodo: "EFECTIVO", referencia: "X" }).error === null) {
    throw new Error("esperaba error con referencia en efectivo");
  }
  if (parseConfirmacion({ metodo: "CHEQUE" }).error === null) {
    throw new Error("esperaba error con método desconocido");
  }
  if (parseConfirmacion({}).error === null) {
    throw new Error("esperaba error sin método");
  }
});

Deno.test("parseConfirmacion valida idempotency_key presente no vacía", () => {
  const ok = parseConfirmacion({ metodo: "EFECTIVO", idempotency_key: "des-1" });
  if (ok.error !== null || ok.idempotencyKey !== "des-1") {
    throw new Error(`esperaba clave conservada, obtuve ${JSON.stringify(ok)}`);
  }
  if (parseConfirmacion({ metodo: "EFECTIVO", idempotency_key: "   " }).error === null) {
    throw new Error("esperaba error con clave vacía");
  }
  const sinClave = parseConfirmacion({ metodo: "EFECTIVO" });
  if (sinClave.error !== null || sinClave.idempotencyKey !== null) {
    throw new Error("esperaba clave opcional en null");
  }
});
