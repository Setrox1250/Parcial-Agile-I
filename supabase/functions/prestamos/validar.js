// HU-05: validación del cuerpo de originación/preview de préstamos (CA-13).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esUuid(valor) {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

// Monto en PEN con hasta 2 decimales; > 0 sin mínimo comercial (CA-13/CP-09).
export function parseMonto(valor) {
  const monto = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(monto) || monto <= 0) {
    return { monto: null, error: 'El monto debe ser un número mayor a cero.' };
  }
  if (Math.round(monto * 100) / 100 !== monto) {
    return { monto: null, error: 'El monto admite como máximo 2 decimales.' };
  }
  if (monto > 10000) {
    return { monto: null, error: 'El monto no puede exceder S/ 10000.00 (cupo global).' };
  }
  return { monto, error: null };
}

// Plazo en meses, 1..60 (RN-07/CP-08).
export function parsePlazo(valor) {
  const plazo = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isInteger(plazo) || plazo < 1 || plazo > 60) {
    return { plazo: null, error: 'El plazo debe estar entre 1 y 60 meses.' };
  }
  return { plazo, error: null };
}

// Fecha de originación opcional (default hoy); nunca futura (5.3/5.4.1).
export function parseFecha(valor) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (valor === undefined || valor === null || valor === '') {
    return { fecha: hoy, error: null };
  }
  if (typeof valor !== 'string' || !FECHA_RE.test(valor) || Number(valor.slice(0, 4)) < 2000) {
    return { fecha: null, error: 'La fecha de originación debe ser una fecha válida (YYYY-MM-DD).' };
  }
  if (valor > hoy) {
    return { fecha: null, error: 'La fecha de originación no puede ser futura.' };
  }
  return { fecha: valor, error: null };
}

// Cuerpo del POST /prestamos. esAdmin controla si sucursalId es requerido.
export function parseCuerpoOriginacion(cuerpo, esAdmin) {
  if (!cuerpo || typeof cuerpo !== 'object') {
    return { error: 'Cuerpo JSON inválido.' };
  }

  if (!esUuid(cuerpo.prestatarioId)) {
    return { error: 'Falta el identificador del prestatario (UUID).' };
  }

  const { monto, error: errorMonto } = parseMonto(cuerpo.monto);
  if (errorMonto) return { error: errorMonto };

  const { plazo, error: errorPlazo } = parsePlazo(cuerpo.plazoMeses);
  if (errorPlazo) return { error: errorPlazo };

  const { fecha, error: errorFecha } = parseFecha(cuerpo.fechaOriginacion);
  if (errorFecha) return { error: errorFecha };

  if (typeof cuerpo.idempotencyKey !== 'string' || cuerpo.idempotencyKey.trim().length < 8) {
    return { error: 'Falta la clave de idempotencia (idempotencyKey, mínimo 8 caracteres).' };
  }

  let sucursalId = null;
  if (esAdmin) {
    if (!esUuid(cuerpo.sucursalId)) {
      return { error: 'ADMIN debe indicar sucursalId (UUID de una sede ACTIVA).' };
    }
    sucursalId = cuerpo.sucursalId;
  }

  return {
    datos: {
      prestatarioId: cuerpo.prestatarioId,
      monto,
      plazo,
      fecha,
      idempotencyKey: cuerpo.idempotencyKey,
      sucursalId,
    },
    error: null,
  };
}

// Cuerpo del POST /prestamos/preview (sin idempotencia ni sucursal).
export function parseCuerpoPreview(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') {
    return { error: 'Cuerpo JSON inválido.' };
  }

  const { monto, error: errorMonto } = parseMonto(cuerpo.monto);
  if (errorMonto) return { error: errorMonto };

  const { plazo, error: errorPlazo } = parsePlazo(cuerpo.plazoMeses);
  if (errorPlazo) return { error: errorPlazo };

  const { fecha, error: errorFecha } = parseFecha(cuerpo.fechaOriginacion);
  if (errorFecha) return { error: errorFecha };

  return { datos: { monto, plazo, fecha }, error: null };
}

// Motivos de rechazo de negocio → status HTTP (conflictos de elegibilidad 409).
const MOTIVOS_CONFLICTO = new Set([
  'CUPO_INSUFICIENTE',
  'BLOQUEADO_AUDITADO',
  'BLOQUEADO_INCIDENCIA_IDENTIDAD',
  'BLOQUEADO_REPRESENTACION_EMPRESA',
  'MOROSO',
  'EXTRAJUDICIAL',
]);

export function statusDeMotivo(motivo) {
  if (motivo === 'PRESTATARIO_INEXISTENTE') return 404;
  return MOTIVOS_CONFLICTO.has(motivo) ? 409 : 400;
}
