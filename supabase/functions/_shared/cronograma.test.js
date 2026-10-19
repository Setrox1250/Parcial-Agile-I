// HU-05 5.7: pruebas unitarias del motor de cronograma (CA-14, CP-10).
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  TEA,
  tasaMensual,
  vencimientoK,
  generarCronograma,
  totalAPagar,
} from './cronograma.js';

function suma(campo, cuotas) {
  return cuotas.reduce((s, c) => s + c[campo], 0);
}

Deno.test('tasa mensual de la TEA 30 % es exacta', () => {
  assertEquals(TEA, 0.30);
  const i = tasaMensual();
  // (1.30)^(1/12) − 1 ≈ 0.022104450… (§4.2)
  assertEquals(Math.abs(i - 0.02210445) < 1e-7, true);
  assertEquals(Math.abs(i * 100 - 2.210445) < 1e-5, true);
});

Deno.test('5.7.1: la suma de capitales iguala el principal (n = 1, 12, 60)', () => {
  for (const [p, n] of [[0.01, 1], [1000, 12], [10000, 60], [1234.56, 7], [500, 31]]) {
    const cuotas = generarCronograma(p, n, '2026-03-15');
    assertEquals(cuotas.length, n, `n=${n}`);
    assertEquals(Math.abs(suma('capital', cuotas) - p) < 0.01, true, `principal=${p}`);
    // 5.2: coherencia total = capital + interés en cada fila.
    for (const c of cuotas) {
      assertEquals(Math.abs(c.total - (c.capital + c.interes)) < 1e-9, true);
      assertEquals(c.capital >= 0 && c.interes >= 0, true);
    }
  }
});

Deno.test('5.7.2: valores manuales n = 1 (principal 1000)', () => {
  // cuota = P(1+i) = 1000 × 1.022104445… ≈ 1022.10
  const cuotas = generarCronograma(1000, 1, '2026-03-15');
  assertEquals(cuotas[0].interes, 22.1);
  assertEquals(cuotas[0].capital, 1000);
  assertEquals(cuotas[0].total, 1022.1);
  assertEquals(cuotas[0].vencimiento, '2026-04-15');
});

Deno.test('5.7.2: valores manuales n = 12 (principal 1000)', () => {
  // cuota francesa ≈ 95.7882… → 95.79 redondeada a centavos.
  const cuotas = generarCronograma(1000, 12, '2026-03-15');
  const primera = cuotas[0];
  // interés 1 = 1000 × 2.210445 % = 22.10
  assertEquals(primera.interes, 22.1);
  assertEquals(primera.capital, 73.69); // 95.79 − 22.10
  assertEquals(primera.total, 95.79);
  // Todas las cuotas intermedias (salvo la última) totalizan la misma cuota.
  for (let k = 0; k < 11; k++) assertEquals(cuotas[k].total, 95.79);
  // Última cuota: liquida el capital restante (ajuste de centavos).
  assertEquals(Math.abs(suma('capital', cuotas) - 1000) < 0.01, true);
  assertEquals(cuotas[11].vencimiento, '2027-03-15');
});

Deno.test('5.7.2: valores manuales n = 60 (principal 10000)', () => {
  const cuotas = generarCronograma(10000, 60, '2026-01-31');
  assertEquals(cuotas.length, 60);
  assertEquals(Math.abs(suma('capital', cuotas) - 10000) < 0.01, true);
  assertEquals(Math.abs(totalAPagar(cuotas) - suma('total', cuotas)) < 1e-9, true);
  // TEA invariante: mismo i_m en toda la serie (RN-41/CA-14).
  assertEquals(Math.abs(suma('interes', cuotas) + suma('capital', cuotas) - totalAPagar(cuotas)) < 1e-9, true);
});

Deno.test('5.7.3: mes calendario con 28/30/31 días', () => {
  // Origen 31-ene: feb (28) usa último día válido; marzo vuelve al 31.
  const enero = generarCronograma(1000, 3, '2026-01-31');
  assertEquals(enero[0].vencimiento, '2026-02-28');
  assertEquals(enero[1].vencimiento, '2026-03-31');
  assertEquals(enero[2].vencimiento, '2026-04-30');
  // Origen 30-abr: febrero de año no bisiesto → 28.
  const abril = generarCronograma(1000, 10, '2026-04-30');
  assertEquals(abril.find((c) => c.vencimiento.startsWith('2027-02')).vencimiento, '2027-02-28');
});

Deno.test('5.7.3: 29 de febrero en año bisiesto', () => {
  const cuotas = generarCronograma(1000, 13, '2028-01-31');
  assertEquals(cuotas[0].vencimiento, '2028-02-29'); // 2028 es bisiesto
  assertEquals(cuotas[1].vencimiento, '2028-03-31');
});

Deno.test('CP-10: cronograma reproducible (misma entrada, misma salida)', () => {
  const a = generarCronograma(2500, 24, '2026-06-01');
  const b = generarCronograma(2500, 24, '2026-06-01');
  assertEquals(a, b);
});

Deno.test('validación de entradas', () => {
  assertThrows(() => generarCronograma(0, 12, '2026-03-15'), Error, 'MONTO_INVALIDO');
  assertThrows(() => generarCronograma(-5, 12, '2026-03-15'), Error, 'MONTO_INVALIDO');
  assertThrows(() => generarCronograma(1000, 0, '2026-03-15'), Error, 'PLAZO_INVALIDO');
  assertThrows(() => generarCronograma(1000, 61, '2026-03-15'), Error, 'PLAZO_INVALIDO');
  assertThrows(() => generarCronograma(1000, 12, 'no-fecha'), Error, 'FECHA_INVALIDA');
});

Deno.test('CP-09: principal mínimo S/ 0.01 con plazo 1', () => {
  const cuotas = generarCronograma(0.01, 1, '2026-03-15');
  assertEquals(cuotas.length, 1);
  assertEquals(cuotas[0].capital, 0.01);
  assertEquals(cuotas[0].interes, 0); // 0.000221… redondea a 0 centavos
  assertEquals(cuotas[0].total, 0.01);
});
