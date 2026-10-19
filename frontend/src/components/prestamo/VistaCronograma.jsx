import Alerta from '../ui/Alerta.jsx'
import Boton from '../ui/Boton.jsx'
import { soles } from '../../utils/dinero.js'
import './prestamo.css'

// Vista previa del cronograma francés (HU-05 5.5): tabla de cuotas, totales y
// gráfico simple de capital vs interés. Reutilizable en HU-09 (historial).
export default function VistaCronograma({
  cuotas,
  totalAPagar,
  onConfirmar,
  cargandoConfirmacion,
  resultado,
}) {
  if (!cuotas?.length) return null

  const totalCapital = cuotas.reduce((s, c) => s + c.capital, 0)
  const totalInteres = cuotas.reduce((s, c) => s + c.interes, 0)
  const mayorTotal = Math.max(...cuotas.map((c) => c.total))
  const pctCapital = (totalCapital / totalAPagar) * 100
  const prestamoRegistrado = resultado?.data?.prestamo

  return (
    <div className="cronograma">
      <div className="cronograma-totales">
        <div className="cronograma-total-dato">
          <span>Total capital</span>
          <strong>{soles(totalCapital)}</strong>
        </div>
        <div className="cronograma-total-dato">
          <span>Total interés (TEA 30 %)</span>
          <strong>{soles(totalInteres)}</strong>
        </div>
        <div className="cronograma-total-dato cronograma-total-dato--principal">
          <span>Total a pagar</span>
          <strong>{soles(totalAPagar)}</strong>
        </div>
      </div>

      {/* Gráfico simple: proporción capital vs interés del contrato (5.5.2). */}
      <div
        className="cronograma-grafico"
        role="img"
        aria-label={`Composición: ${pctCapital.toFixed(0)} % capital y ${(100 - pctCapital).toFixed(0)} % interés`}
      >
        <div className="cronograma-grafico-barra">
          <div className="cronograma-grafico-capital" style={{ width: `${pctCapital}%` }} />
        </div>
        <div className="cronograma-grafico-leyenda">
          <span className="cronograma-leyenda-cap">
            Capital {soles(totalCapital)} ({pctCapital.toFixed(1)} %)
          </span>
          <span className="cronograma-leyenda-int">
            Interés {soles(totalInteres)} ({(100 - pctCapital).toFixed(1)} %)
          </span>
        </div>
      </div>

      <div className="cronograma-tabla-envoltura">
        <table className="cronograma-tabla">
          <thead>
            <tr>
              <th scope="col">N.º</th>
              <th scope="col">Vencimiento</th>
              <th scope="col">Capital</th>
              <th scope="col">Interés</th>
              <th scope="col">Total</th>
              <th scope="col" aria-label="Proporción" className="cronograma-col-grafico" />
            </tr>
          </thead>
          <tbody>
            {cuotas.map((c) => (
              <tr key={c.numero}>
                <td>{c.numero}</td>
                <td>{c.vencimiento}</td>
                <td>{soles(c.capital)}</td>
                <td>{soles(c.interes)}</td>
                <td>{soles(c.total)}</td>
                <td className="cronograma-col-grafico">
                  <div className="cronograma-mini-barra" aria-hidden="true">
                    <div
                      className="cronograma-mini-capital"
                      style={{ width: `${(c.capital / mayorTotal) * 100}%` }}
                    />
                    <div
                      className="cronograma-mini-interes"
                      style={{ width: `${(c.interes / mayorTotal) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resultado?.ok ? (
        <Alerta tipo="ok">
          {resultado.data?.idempotente
            ? 'Este préstamo ya había sido registrado con la misma clave (idempotente).'
            : prestamoRegistrado
              ? `Préstamo originado: ${soles(prestamoRegistrado.principal)} en ${prestamoRegistrado.plazoMeses} cuotas, estado ${prestamoRegistrado.estado}.`
              : 'Préstamo originado correctamente.'}
        </Alerta>
      ) : resultado?.error ? (
        <Alerta tipo="error">{resultado.error.message}</Alerta>
      ) : null}

      <div className="cronograma-acciones">
        <Boton onClick={onConfirmar} cargando={cargandoConfirmacion} disabled={!!resultado?.ok}>
          {resultado?.ok ? 'Préstamo confirmado' : 'Confirmar préstamo'}
        </Boton>
      </div>
    </div>
  )
}
