-- HU-07 (continuación): imputación de pagos confirmados a cuotas capital/interés.
-- Requisitos: existe `cuotas` (HU-05). Aplica RN-11/RN-22/RN-24/RN-25/RN-41, CA-18, CP-12/CP-13/CP-17/CP-19/CP-19A.
-- La transferencia sin verificar no se imputa (RN-23/CA-20).

-- 1) Tabla de imputaciones por pago y cuota
CREATE TABLE public.pagos_imputaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pago_id UUID NOT NULL
        REFERENCES public.pagos(id) ON DELETE RESTRICT,
    cuota_id UUID NOT NULL
        REFERENCES public.cuotas(id) ON DELETE RESTRICT,
    importe_capital NUMERIC(12,2) NOT NULL,
    importe_interes NUMERIC(12,2) NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pagos_imp_capital_no_negativo CHECK (importe_capital >= 0),
    CONSTRAINT pagos_imp_interes_no_negativo CHECK (importe_interes >= 0),
    CONSTRAINT pagos_imp_total_positivo CHECK (importe_capital + importe_interes > 0),
    CONSTRAINT pagos_imp_unico UNIQUE (pago_id, cuota_id)
);

COMMENT ON TABLE public.pagos_imputaciones IS
    'HU-07: desagrega un pago confirmado entre capital e interés por cuota (RN-22).';
COMMENT ON COLUMN public.pagos_imputaciones.importe_capital IS
    'Amortización de capital; únicamente esta reduce capital_insoluto y libera cupo (RN-11).';
COMMENT ON COLUMN public.pagos_imputaciones.importe_interes IS
    'Abono a intereses programados; no libera cupo (RN-11). No recalcula intereses (RN-24/RN-41).';

CREATE INDEX idx_pagos_imp_pago ON public.pagos_imputaciones (pago_id);
CREATE INDEX idx_pagos_imp_cuota ON public.pagos_imputaciones (cuota_id);

ALTER TABLE public.pagos_imputaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pagos_imputaciones FROM anon, authenticated;

-- 2) Vista de apoyo: total imputado confirmado por cuota
CREATE OR REPLACE VIEW public.cuotas_totales_imputados AS
SELECT
    qi.cuota_id,
    SUM(qi.importe_capital) AS total_capital,
    SUM(qi.importe_interes) AS total_interes,
    SUM(qi.importe_capital + qi.importe_interes) AS total_abonado
FROM public.pagos_imputaciones qi
JOIN public.pagos p ON p.id = qi.pago_id
WHERE p.estado IN ('CONFIRMADO')
GROUP BY qi.cuota_id;

COMMENT ON VIEW public.cuotas_totales_imputados IS
    'Suma de imputaciones confirmadas por cuota (RN-21).';

-- 3) Función de distribución de un pago sobre cuotas impagas (vista previa + ejecución)
CREATE OR REPLACE FUNCTION public.distribuir_pago(
    p_prestamo_id UUID,
    p_monto NUMERIC(12,2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_restante NUMERIC(12,2) := p_monto;
    v_dist JSONB := '[]'::jsonb;
    r RECORD;
    v_saldo_cap NUMERIC(12,2);
    v_saldo_int NUMERIC(12,2);
    v_asignar_cap NUMERIC(12,2);
    v_asignar_int NUMERIC(12,2);
    v_cubre_total BOOLEAN;
    v_sum_imp NUMERIC(12,2);
BEGIN
    IF p_monto IS NULL OR p_monto <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'MONTO_INVALIDO', 'detalle', '[]'::jsonb);
    END IF;

    FOR r IN
        SELECT c.id, c.numero, c.vencimiento,
               c.capital_programado, c.interes_programado, c.total_programado,
               COALESCE(t.total_capital, 0) AS imp_cap,
               COALESCE(t.total_interes, 0) AS imp_int,
               (c.total_programado - COALESCE(t.total_abonado, 0)) AS saldo_total
        FROM public.cuotas c
        LEFT JOIN public.cuotas_totales_imputados t ON t.cuota_id = c.id
        WHERE c.prestamo_id = p_prestamo_id
          AND c.estado <> 'PAGADA'
        ORDER BY c.numero ASC, c.vencimiento ASC
    LOOP
        IF v_restante <= 0 THEN EXIT; END IF;
        IF r.saldo_total <= 0 THEN CONTINUE; END IF;

        v_saldo_cap := GREATEST(0, r.capital_programado - r.imp_cap);
        v_saldo_int := GREATEST(0, r.interes_programado - r.imp_int);
        v_sum_imp := v_saldo_cap + v_saldo_int;

        v_asignar_cap := 0; v_asignar_int := 0;
        IF v_restante >= v_sum_imp THEN
            v_asignar_cap := v_saldo_cap;
            v_asignar_int := v_saldo_int;
            v_cubre_total := true;
        ELSE
            -- Asignación prioriza capital sobre intereses cuando el pago es parcial a la cuota (RN-11/RN-22)
            -- pero lo que importa es cuadrar con cronograma: se reparte proporcionalmente al saldo pendiente
            -- y se redondea a 2 decimales asignando centavos al capital primero para minimizar diferencia.
            v_asignar_cap := LEAST(v_saldo_cap, v_restante);
            v_restante := v_restante - v_asignar_cap;
            v_asignar_int := LEAST(v_saldo_int, v_restante);
            v_restante := v_restante - v_asignar_int;
            v_cubre_total := false;
            v_restante := 0; -- liquidado después de asignar
        END IF;

        IF v_asignar_cap <> 0 OR v_asignar_int <> 0 THEN
            v_dist := v_dist || jsonb_build_object(
                'cuota_id', r.id,
                'numero', r.numero,
                'vencimiento', to_char(r.vencimiento, 'YYYY-MM-DD'),
                'importe_capital', v_asignar_cap,
                'importe_interes', v_asignar_int,
                'cubre_total', v_cubre_total
            );
        END IF;

        IF v_cubre_total THEN
            v_restante := v_restante - (v_asignar_cap + v_asignar_int);
        END IF;
    END LOOP;

    IF v_restante > 0.005 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'MONTO_EXCEDE_SALDO', 'detalle', v_dist);
    END IF;

    RETURN jsonb_build_object('ok', true, 'motivo', NULL, 'detalle', v_dist, 'sobrante', 0);
END;
$$;

COMMENT ON FUNCTION public.distribuir_pago(UUID, NUMERIC) IS
    'HU-07: calcula distribución capital/interés por orden de cuota impaga más antigua (RN-20/RN-22). No recalcula intereses (RN-24/RN-41).';

REVOKE ALL ON FUNCTION public.distribuir_pago(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.distribuir_pago(UUID, NUMERIC) TO service_role;
