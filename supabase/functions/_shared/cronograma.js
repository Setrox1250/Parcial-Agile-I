// HU-05: motor de cronograma francés con TEA fija 30 % (§4.2, RN-06/41, CA-14).
// Módulo puro sin I/O: lo consumen preview y originación (EF prestamos) y las
// pruebas unitarias (cronograma.test.js). Los importes se calculan en centavos
// enteros (5.1.4); la última cuota absorbe el ajuste de centavos.

export const TEA = 0.30;

// i_m = (1 + TEA)^(1/12) − 1 ≈ 0.02210445 (periodos mensuales homogéneos).
export function tasaMensual(tea = TEA) {
  return Math.pow(1 + tea, 1 / 12) - 1;
}

// Vencimiento k: mes calendario desde la originación; si el día no existe en el
// mes destino se usa el último día válido (B-03). Cálculo en UTC sin husos.
export function vencimientoK(fechaOriginacion, k) {
  const [anio, mes, dia] = fechaOriginacion.split('-').map(Number);
  const destino = new Date(Date.UTC(anio, mes - 1 + k, 1));
  const ultimoDia = new Date(
    Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  const mm = String(destino.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(diaFinal).padStart(2, '0');
  return `${destino.getUTCFullYear()}-${mm}-${dd}`;
}

// Cronograma francés: cuota constante; interés = capital_inicio × i_m;
// amortización = cuota − interés; la última cuota liquida el capital restante.
// Devuelve [{ numero, vencimiento, capital, interes, total }] en soles (2 dec).
export function generarCronograma(principal, plazoMeses, fechaOriginacion) {
  if (typeof principal !== 'number' || !(principal > 0)) {
    throw new Error('MONTO_INVALIDO');
  }
  if (!Number.isInteger(plazoMeses) || plazoMeses < 1 || plazoMeses > 60) {
    throw new Error('PLAZO_INVALIDO');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaOriginacion ?? '')) {
    throw new Error('FECHA_INVALIDA');
  }

  const i = tasaMensual();
  const P = Math.round(principal * 100);
  const cuotaC = Math.round((P * i) / (1 - Math.pow(1 + i, -plazoMeses)));

  const cuotas = [];
  let insoluto = P;
  for (let n = 1; n <= plazoMeses; n++) {
    const interesC = Math.round(insoluto * i);
    // Última cuota: liquida el capital restante (ajuste de centavos, 5.1.4).
    const capitalC = n === plazoMeses ? insoluto : Math.max(0, cuotaC - interesC);
    insoluto -= capitalC;
    cuotas.push({
      numero: n,
      vencimiento: vencimientoK(fechaOriginacion, n),
      capital: capitalC / 100,
      interes: interesC / 100,
      total: (capitalC + interesC) / 100,
    });
  }
  return cuotas;
}

// Utilidad compartida: total a pagar del cronograma.
export function totalAPagar(cuotas) {
  return cuotas.reduce((suma, c) => suma + c.total, 0);
}
