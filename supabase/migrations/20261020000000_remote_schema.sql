drop extension if exists "pg_net";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.imputar_pago_confirmado(p_pago_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.originar_prestamo(p_prestatario_id uuid, p_monto numeric, p_plazo_meses integer, p_sucursal_id uuid, p_fecha_originacion date, p_creado_por uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_cuotas jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_existente UUID;
    v_reserva JSONB;
    v_prestamo_id UUID;
    v_cuotas JSONB;
    v_suma_capital NUMERIC(12,2);
BEGIN
    -- RN-31/CA-15: misma idempotency_key devuelve préstamo + cuotas existentes.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existente
        FROM public.prestamos
        WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            SELECT jsonb_agg(jsonb_build_object(
                       'numero', c.numero,
                       'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
                       'capital', c.capital_programado,
                       'interes', c.interes_programado,
                       'total', c.total_programado,
                       'estado', c.estado
                   ) ORDER BY c.numero)
            INTO v_cuotas
            FROM public.cuotas c
            WHERE c.prestamo_id = v_existente;

            RETURN jsonb_build_object(
                'ok', true, 'idempotente', true,
                'prestamo_id', v_existente, 'motivo', NULL,
                'cuotas', COALESCE(v_cuotas, '[]'::jsonb)
            );
        END IF;
    END IF;

    IF p_monto IS NULL OR p_monto <= 0 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'MONTO_INVALIDO'
        );
    END IF;

    IF p_plazo_meses IS NULL OR p_plazo_meses NOT BETWEEN 1 AND 60 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'PLAZO_INVALIDO'
        );
    END IF;

    IF p_fecha_originacion IS NULL OR p_fecha_originacion > CURRENT_DATE THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'FECHA_INVALIDA'
        );
    END IF;

    -- CA-14: el cronograma llega calculado (motor EF/_shared); aquí se validan
    -- los invariantes de servidor (defensa en profundidad, sin doble matemática).
    IF p_cuotas IS NULL OR jsonb_typeof(p_cuotas) <> 'array'
        OR jsonb_array_length(p_cuotas) <> p_plazo_meses THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- Filas coherentes: totales, no negatividad y vencimiento posterior a la originación.
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_cuotas) c
        WHERE (c->>'numero') IS NULL
           OR (c->>'vencimiento') IS NULL
           OR (c->>'capital') IS NULL
           OR (c->>'interes') IS NULL
           OR (c->>'total') IS NULL
           OR (c->>'capital')::numeric < 0
           OR (c->>'interes')::numeric < 0
           OR (c->>'total')::numeric <> (c->>'capital')::numeric + (c->>'interes')::numeric
           OR (c->>'vencimiento')::date <= p_fecha_originacion
    ) THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- Números consecutivos 1..n (5.2.2 aplicado antes del insert).
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_cuotas) WITH ORDINALITY t(c, ord)
        WHERE (c->>'numero')::integer <> t.ord
    ) THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- 5.7.1: la suma de capitales programados debe igualar el principal (tol. 0.01).
    SELECT COALESCE(SUM((c->>'capital')::numeric), 0)
    INTO v_suma_capital
    FROM jsonb_array_elements(p_cuotas) c;

    IF ABS(v_suma_capital - p_monto) > 0.01 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- Reserva de cupo + elegibilidad (HU-04, RN-09/15/32): misma transacción.
    v_reserva := public.reservar_cupo(
        p_prestatario_id, p_monto, p_plazo_meses,
        p_sucursal_id, p_creado_por, p_idempotency_key
    );
    IF NOT (v_reserva->>'ok')::boolean THEN
        RETURN v_reserva || jsonb_build_object('idempotente', false);
    END IF;

    v_prestamo_id := (v_reserva->>'prestamo_id')::uuid;

    -- Reserva idempotente (carrera con la misma key): las cuotas ya se crearon.
    IF (v_reserva->>'idempotente')::boolean THEN
        SELECT jsonb_agg(jsonb_build_object(
                   'numero', c.numero,
                   'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
                   'capital', c.capital_programado,
                   'interes', c.interes_programado,
                   'total', c.total_programado,
                   'estado', c.estado
               ) ORDER BY c.numero)
        INTO v_cuotas
        FROM public.cuotas c
        WHERE c.prestamo_id = v_prestamo_id;

        RETURN jsonb_build_object(
            'ok', true, 'idempotente', true,
            'prestamo_id', v_prestamo_id, 'motivo', NULL,
            'cuotas', COALESCE(v_cuotas, '[]'::jsonb)
        );
    END IF;

    UPDATE public.prestamos
    SET fecha_originacion = p_fecha_originacion
    WHERE id = v_prestamo_id;

    INSERT INTO public.cuotas (
        prestamo_id, numero, vencimiento,
        capital_programado, interes_programado, total_programado
    )
    SELECT
        v_prestamo_id,
        (c->>'numero')::integer,
        (c->>'vencimiento')::date,
        (c->>'capital')::numeric,
        (c->>'interes')::numeric,
        (c->>'total')::numeric
    FROM jsonb_array_elements(p_cuotas) c;

    SELECT jsonb_agg(jsonb_build_object(
               'numero', c.numero,
               'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
               'capital', c.capital_programado,
               'interes', c.interes_programado,
               'total', c.total_programado,
               'estado', c.estado
           ) ORDER BY c.numero)
    INTO v_cuotas
    FROM public.cuotas c
    WHERE c.prestamo_id = v_prestamo_id;

    RETURN jsonb_build_object(
        'ok', true, 'idempotente', false,
        'prestamo_id', v_prestamo_id, 'motivo', NULL,
        'cuotas', v_cuotas
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revertir_pago_confirmado(p_pago_id uuid, p_motivo text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pago public.pagos%ROWTYPE; v_capital NUMERIC(12,2); v_existente UUID;
BEGIN
    SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'PAGO_INEXISTENTE'); END IF;
    SELECT id INTO v_existente FROM public.pagos_reversiones WHERE pago_id = p_pago_id;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotente', true, 'reversion_id', v_existente); END IF;
    IF v_pago.estado <> 'CONFIRMADO' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'PAGO_NO_CONFIRMADO'); END IF;
    IF p_actor IS NULL OR p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'REVERSO_INVALIDO'); END IF;
    SELECT COALESCE(SUM(importe_capital), 0) INTO v_capital FROM public.pagos_imputaciones WHERE pago_id = p_pago_id;
    INSERT INTO public.pagos_reversiones (pago_id, motivo, reversado_por) VALUES (p_pago_id, trim(p_motivo), p_actor) RETURNING id INTO v_existente;
    UPDATE public.pagos SET estado = 'REVERSADO', confirma = p_actor, confirmado_en = now() WHERE id = p_pago_id;
    -- Fix 2: el subquery unía la vista con alias `v` pero se leía `t.total_abonado`.
    UPDATE public.cuotas c SET estado = CASE WHEN COALESCE(t.total_abonado,0) <= .005 THEN 'PENDIENTE' WHEN COALESCE(t.total_abonado,0) >= c.total_programado - .005 THEN 'PAGADA' ELSE 'PARCIAL' END, actualizado_en = now()
    FROM (SELECT c2.id, COALESCE(v.total_abonado,0) total_abonado FROM public.cuotas c2 LEFT JOIN public.cuotas_totales_imputados v ON v.cuota_id=c2.id WHERE c2.prestamo_id=v_pago.prestamo_id) t WHERE c.id=t.id;
    UPDATE public.prestamos SET estado = CASE WHEN estado='PAGADO' THEN 'ACTIVO' ELSE estado END, capital_insoluto = LEAST(principal, capital_insoluto + v_capital), actualizado_en=now() WHERE id=v_pago.prestamo_id;
    PERFORM public.sincronizar_mora_prestamo(v_pago.prestamo_id);
    RETURN jsonb_build_object('ok', true, 'idempotente', false, 'reversion_id', v_existente);
END; $function$
;


