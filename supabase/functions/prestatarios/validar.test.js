// HU-09: validación de la búsqueda global y la ruta de historial (RN-01).
import { assertEquals } from "jsr:@std/assert@1";
import { esUuid, parsearBusqueda, parsearRutaHistorial } from "./validar.js";

// RUC válido de prueba: 2012345678 + DV 6 (módulo 11 SUNAT).
const RUC_OK = "20123456786";
const UUID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

Deno.test("esUuid", () => {
  assertEquals(esUuid(UUID), true);
  assertEquals(esUuid("no"), false);
});

Deno.test("búsqueda: exactamente un documento", () => {
  assertEquals(parsearBusqueda(new URLSearchParams("")).error !== null, true);
  assertEquals(
    parsearBusqueda(new URLSearchParams(`dni=12345678&ruc=${RUC_OK}`)).error !== null,
    true,
    "ambos rechazados",
  );

  const dni = parsearBusqueda(new URLSearchParams("dni=12345678"));
  assertEquals(dni.error, null);
  assertEquals(dni.tipo, "dni");
  assertEquals(dni.valor, "12345678");

  const ruc = parsearBusqueda(new URLSearchParams(`ruc=${RUC_OK}`));
  assertEquals(ruc.error, null);
  assertEquals(ruc.tipo, "ruc");
});

Deno.test("búsqueda: formatos inválidos (RN-01)", () => {
  assertEquals(parsearBusqueda(new URLSearchParams("dni=123")).error !== null, true);
  assertEquals(parsearBusqueda(new URLSearchParams("dni=123456789")).error !== null, true);
  assertEquals(parsearBusqueda(new URLSearchParams("dni=abcdefgh")).error !== null, true);
  assertEquals(parsearBusqueda(new URLSearchParams("ruc=20123456789")).error !== null, true, "DV malo");
  assertEquals(parsearBusqueda(new URLSearchParams("ruc=201234567")).error !== null, true, "corto");
});

Deno.test("ruta de historial", () => {
  const ok = parsearRutaHistorial(`/${UUID}/historial`);
  assertEquals(ok.error, null);
  assertEquals(ok.prestatarioId, UUID);

  // Ruta real que entrega el gateway de Supabase (regresión E2E HU-09).
  const conPrefijo = parsearRutaHistorial(`/functions/v1/prestatarios/${UUID}/historial`);
  assertEquals(conPrefijo.error, null);
  assertEquals(conPrefijo.prestatarioId, UUID);

  assertEquals(parsearRutaHistorial("/buscar").error !== null, true);
  assertEquals(parsearRutaHistorial(`/${UUID}/otra`).error !== null, true);
  assertEquals(parsearRutaHistorial("/no-uuid/historial").error !== null, true);
  assertEquals(parsearRutaHistorial(`/${UUID}`).error !== null, true);
});
