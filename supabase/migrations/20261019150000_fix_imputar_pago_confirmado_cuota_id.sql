-- Fix (encontrado por el E2E de HU-09): imputar_pago_confirmado tenía dos
-- fallos que rompían todo cobro imputable sobre un préstamo con cuotas:
--   1) el bucle de bloqueo comparaba uuid = text (->> sin cast) → "operator
--      does not exist: uuid = text";
--   2) el pago final actualizaba capital_insoluto = 0 con estado todavía
--      ACTIVO, violando prestamos_importes_coherentes (RN-09 exige
--      ACTIVO → capital_insoluto > 0); ahora estado PAGADO y capital 0 se
--      aplican en UN solo UPDATE cuando todas las cuotas quedan PAGADAS.
-- El resto de la función es idéntica a 20261019130000_hu07_pagos.sql.
CREATE OR REPLACE FUNCTION public.imputar_pago_confirmado(
    p_pago_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pago public.pagos%ROWTYPE;
    v_prestamo_id UUID;
    v_monto NUMERIC(12,2);
    v_dist JSONB;
    d RECORD;
    v_cap_antes NUMERIC(12,2);
    v_quedan_impagas INT;
    v_total_cuotas INT;
    v_cap_lib NUMERIC(12,2) := 0;
    r_c RECORD;
BEGIN
    SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'PAGO_INEXISTENTE');
    END IF;
    IF v_pago.estado <> 'CONFIRMADO' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'PAGO_NO_CONFIRMADO');
    END IF;
    IF v_pago.imputado_en IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'idempotente', true, 'motivo', 'YA_IMPUTADO');
    END IF;

    v_prestamo_id := v_pago.prestamo_id;
    v_monto := v_pago.monto;

    -- Distribución con FOR UPDATE de cuotas para evitar carreras
    SELECT * INTO v_dist FROM public.distribuir_pago(v_prestamo_id, v_monto);
    IF NOT (v_dist->>'ok')::boolean THEN
        RETURN jsonb_build_object('ok', false, 'motivo', v_dist->>'motivo', 'detalle', v_dist->>'detalle');
    END IF;

    -- Bloquear cuotas afectadas (cast explícito: jsonb ->> devuelve text)
    FOR d IN SELECT ((jsonb_array_elements(v_dist->'detalle'))->>'cuota_id')::uuid AS cuota_id
    LOOP
        PERFORM 1 FROM public.cuotas WHERE id = d.cuota_id FOR UPDATE;
    END LOOP;

    -- Ejecutar imputaciones
    FOR d IN SELECT * FROM jsonb_to_recordset(v_dist->'detalle') AS x(
        cuota_id UUID, importe_capital NUMERIC(12,2), importe_interes NUMERIC(12,2)
    )
    LOOP
        INSERT INTO public.pagos_imputaciones (pago_id, cuota_id, importe_capital, importe_interes)
        VALUES (p_pago_id, d.cuota_id, d.importe_capital, d.importe_interes)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Actualizar cuotas: estado PARCIAL/PAGADA según saldo
    FOR r_c IN
        SELECT c.id, c.capital_programado, c.interes_programado,
               COALESCE(t.total_capital, 0) AS imp_cap,
               COALESCE(t.total_interes, 0) AS imp_int,
               (c.capital_programado - COALESCE(t.total_capital, 0)) AS saldo_cap,
               (c.total_programado - COALESCE(t.total_abonado, 0)) AS saldo_total
        FROM public.cuotas c
        LEFT JOIN public.cuotas_totales_imputados t ON t.cuota_id = c.id
        WHERE c.prestamo_id = v_prestamo_id
    LOOP
        IF r_c.saldo_total <= 0.005 THEN
            UPDATE public.cuotas SET estado = 'PAGADA', actualizado_en = now()
            WHERE id = r_c.id AND estado <> 'PAGADA';
        ELSIF r_c.imp_cap > 0 OR r_c.imp_int > 0 THEN
            UPDATE public.cuotas SET estado = 'PARCIAL', actualizado_en = now()
            WHERE id = r_c.id AND estado NOT IN ('PAGADA','PARCIAL');
        END IF;
    END LOOP;

    -- Calcular capital liberado (solo capital amortizado) RN-11
    SELECT COALESCE(SUM(qi.importe_capital), 0) INTO v_cap_lib
    FROM public.pagos_imputaciones qi
    WHERE qi.pago_id = p_pago_id;

    -- Si todas las cuotas PAGADAS: préstamo PAGADO con capital 0 en UNA sola
    -- sentencia (RN-25 + RN-09; capital y estado nunca en pasos separados).
    SELECT COUNT(*) FILTER (WHERE estado <> 'PAGADA'), COUNT(*)
    INTO v_quedan_impagas, v_total_cuotas
    FROM public.cuotas
    WHERE prestamo_id = v_prestamo_id;

    IF v_quedan_impagas = 0 AND v_total_cuotas > 0 THEN
        UPDATE public.prestamos
        SET estado = 'PAGADO', capital_insoluto = 0, actualizado_en = now()
        WHERE id = v_prestamo_id AND estado <> 'PAGADO';
    ELSIF v_cap_lib > 0 THEN
        -- Reducir capital_insoluto del préstamo (siempre >=0) RN-11
        SELECT capital_insoluto INTO v_cap_antes FROM public.prestamos WHERE id = v_prestamo_id FOR UPDATE;
        UPDATE public.prestamos
        SET capital_insoluto = GREATEST(0, capital_insoluto - v_cap_lib),
            actualizado_en = now()
        WHERE id = v_prestamo_id;
    END IF;

    UPDATE public.pagos SET imputado_en = now() WHERE id = p_pago_id;
    RETURN jsonb_build_object('ok', true, 'idempotente', false, 'capital_liberado', v_cap_lib);
END;
$$;

COMMENT ON FUNCTION public.imputar_pago_confirmado(UUID) IS
    'HU-07: imputa un pago CONFIRMADO a cuotas (orden antigua → nueva), distingue capital/interés, actualiza estados, reduce capital_insoluto (RN-11), pasa a PAGADO si corresponde (RN-25), sin recalcular intereses (RN-24/RN-41). Fix: bloqueo con cuota_id cast a uuid y cierre PAGADO+capital 0 atómico (RN-09).';

REVOKE ALL ON FUNCTION public.imputar_pago_confirmado(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imputar_pago_confirmado(UUID) TO service_role;
