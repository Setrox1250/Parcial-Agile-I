// HU-05: validación del cuerpo de originación (CA-13/CP-08/CP-09).
import { assertEquals } from 'jsr:@std/assert@1';
import {
  esUuid,
  parseMonto,
  parsePlazo,
  parseFecha,
  parseCuerpoOriginacion,
  parseCuerpoPreview,
  statusDeMotivo,
} from './validar.js';

const UUID = '3f1d2a8e-6b4c-4f9a-9e2d-1c7b8a9d0e11';

Deno.test('CP-09: montos', () => {
  assertEquals(parseMonto(0).error !== null, true);
  assertEquals(parseMonto(-1).error !== null, true);
  assertEquals(parseMonto(0.01).monto, 0.01);
  assertEquals(parseMonto(10000).monto, 10000);
  assertEquals(parseMonto(10000.01).error !== null, true);
  assertEquals(parseMonto(10.123).error !== null, true, 'máximo 2 decimales');
  assertEquals(parseMonto('250.50').monto, 250.5);
});

Deno.test('CP-08: plazos', () => {
  assertEquals(parsePlazo(0).error !== null, true);
  assertEquals(parsePlazo(61).error !== null, true);
  assertEquals(parsePlazo(1).plazo, 1);
  assertEquals(parsePlazo(60).plazo, 60);
  assertEquals(parsePlazo(12.5).error !== null, true, 'entero');
});

Deno.test('fechas de originación', () => {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  assertEquals(parseFecha(undefined).fecha, hoy);
  assertEquals(parseFecha('2026-01-31').fecha, '2026-01-31');
  assertEquals(parseFecha('2099-01-01').error !== null, true, 'futura rechazada');
  assertEquals(parseFecha('2026-02-31').error !== null, true, 'día inexistente rechazado');
  assertEquals(parseFecha('2024-02-29').fecha, '2024-02-29', 'año bisiesto aceptado');
  assertEquals(parseFecha('no').error !== null, true);
});

Deno.test('cuerpo de originación', () => {
  const base = {
    prestatarioId: UUID,
    monto: 1500,
    plazoMeses: 12,
    idempotencyKey: 'clave-12345678',
  };

  // SUPERVISOR: sin sucursal explícita.
  const sup = parseCuerpoOriginacion(base, false);
  assertEquals(sup.error, null);
  assertEquals(sup.datos.sucursalId, null);

  // ADMIN: sucursal obligatoria.
  assertEquals(parseCuerpoOriginacion(base, true).error !== null, true);
  const admin = parseCuerpoOriginacion({ ...base, sucursalId: UUID }, true);
  assertEquals(admin.error, null);
  assertEquals(admin.datos.sucursalId, UUID);

  // IdempotencyKey obligatoria y >= 8 caracteres (RN-31).
  assertEquals(parseCuerpoOriginacion({ ...base, idempotencyKey: 'corta' }, false).error !== null, true);
  assertEquals(parseCuerpoOriginacion({ ...base, idempotencyKey: undefined }, false).error !== null, true);

  assertEquals(parseCuerpoOriginacion({ ...base, prestatarioId: 'x' }, false).error !== null, true);
  assertEquals(parseCuerpoOriginacion(null, false).error !== null, true);
});

Deno.test('cuerpo de preview', () => {
  const ok = parseCuerpoPreview({ monto: 0.01, plazoMeses: 1 });
  assertEquals(ok.error, null);
  assertEquals(ok.datos.plazo, 1);
  assertEquals(parseCuerpoPreview({ monto: -1, plazoMeses: 1 }).error !== null, true);
  assertEquals(parseCuerpoPreview({ monto: 100, plazoMeses: 61 }).error !== null, true);
});

Deno.test('motivos → status HTTP', () => {
  assertEquals(statusDeMotivo('CUPO_INSUFICIENTE'), 409);
  assertEquals(statusDeMotivo('MOROSO'), 409);
  assertEquals(statusDeMotivo('PRESTATARIO_INEXISTENTE'), 404);
  assertEquals(statusDeMotivo('MONTO_INVALIDO'), 400);
  assertEquals(statusDeMotivo('CRONOGRAMA_INVALIDO'), 400);
});

Deno.test('esUuid', () => {
  assertEquals(esUuid(UUID), true);
  assertEquals(esUuid('no-uuid'), false);
  assertEquals(esUuid(42), false);
});
