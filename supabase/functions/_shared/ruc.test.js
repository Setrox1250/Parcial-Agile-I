import {
  assertEquals,
} from "jsr:@std/assert@1";
import {
  calcularDigitoVerificadorRuc,
  dniDesdeRuc10,
  esRucPersonaNatural,
  esRucValido,
  prefijoRuc,
  rucDesdeDni,
} from "./ruc.js";

Deno.test("dígito verificador — vector real de SUNAT (20131312955)", () => {
  assertEquals(calcularDigitoVerificadorRuc("2013131295"), 5);
});

Deno.test("dígito verificador — bordes del módulo 11 (resta 11 -> 1, resta 10 -> 0)", () => {
  assertEquals(calcularDigitoVerificadorRuc("0000000000"), 1);
  assertEquals(calcularDigitoVerificadorRuc("0000000006"), 0);
});

Deno.test("esRucValido — acepta el vector real y rechaza el dígito cambiado", () => {
  assertEquals(esRucValido("20131312955"), true);
  assertEquals(esRucValido("20131312954"), false);
  assertEquals(esRucValido("2013131295"), false);
  assertEquals(esRucValido("abcdefghijk"), false);
});

Deno.test("dni <-> ruc10 — ida y vuelta para varios DNIs (incluye ceros a la izquierda)", () => {
  const dnis = ["60993370", "00123456", "00000000", "12345678", "00000001"];
  for (const dni of dnis) {
    const ruc = rucDesdeDni(dni);
    assertEquals(typeof ruc, "string");
    assertEquals(esRucValido(ruc), true);
    assertEquals(dniDesdeRuc10(ruc), dni);
  }
});

Deno.test("dniDesdeRuc10 — null cuando no es un RUC 10 válido", () => {
  assertEquals(dniDesdeRuc10("20131312955"), null);
  assertEquals(dniDesdeRuc10("15123456789"), null);
  assertEquals(dniDesdeRuc10("1060993371"), null);
});

Deno.test("prefijo y tipo de RUC", () => {
  assertEquals(prefijoRuc("10609933700"), "10");
  assertEquals(esRucPersonaNatural("10609933700"), true);
  assertEquals(esRucPersonaNatural("20131312955"), false);
  assertEquals(prefijoRuc("2013131"), "");
});
