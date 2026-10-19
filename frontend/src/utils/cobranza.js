// Normaliza datos de cobro que llegan de listarCobranza (HU-07) y del historial
// consolidado (HU-09) para compartirlos entre la pantalla de Cobranza y la
// vista 360.

function hoyLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
}

// VENCIDA no se persiste: es condición derivada de fecha + saldo (HU-07/HU-08).
export function normalizarCuotas(cuotas = []) {
  return cuotas.map((c) => {
    const montoProgramado = Number(c.montoProgramado ?? c.totalProgramado ?? 0)
    const montoAbonado = Number(c.montoAbonado ?? c.abonado ?? 0)
    const saldo = Math.max(0, Math.round((montoProgramado - montoAbonado) * 100) / 100)
    const estado = saldo <= 0.005
      ? 'PAGADA'
      : String(c.vencimiento ?? '').slice(0, 10) < hoyLima()
        ? 'VENCIDA'
        : montoAbonado > 0
          ? 'PARCIAL'
          : 'PENDIENTE'
    return {
      numero: c.numero,
      vencimiento: String(c.vencimiento ?? '').slice(0, 10),
      montoProgramado,
      montoAbonado,
      saldo,
      estado,
    }
  })
}

export function normalizarPrestamo(p) {
  return {
    id: p.id,
    principal: Number(p.principal ?? 0),
    capitalInsoluto: p.capitalInsoluto != null ? Number(p.capitalInsoluto) : null,
    sucursal: p.sucursal ?? null,
    estado: p.estado ?? null,
    desembolsadoEn: p.desembolsadoEn ?? null,
    prestatario: p.prestatario ?? null,
    cuotas: p.cuotas ? normalizarCuotas(p.cuotas) : null,
  }
}

// VENCIDA se deriva de fecha + saldo; usado en la tabla de cuotas del expediente.
export function estadoCuota(cuota) {
  if (Number(cuota.saldo) <= 0.005) return 'PAGADA'
  if (String(cuota.vencimiento ?? '').slice(0, 10) < hoyLima()) return 'VENCIDA'
  if (Number(cuota.abonado) > 0) return 'PARCIAL'
  return 'PENDIENTE'
}
