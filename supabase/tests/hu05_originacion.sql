-- HU-05: pruebas de originación de préstamos y cronograma
-- (CP-08, CP-09, CP-10, CP-11 vía originar, CP-28; CA-13/14/15; RN-06/07/08/16/31).
-- El motor francés se prueba en deno (functions/_shared/cronograma.test.js);
-- aquí se validan invariantes de servidor, atomicidad e idempotencia.
--
-- Ejecutar (stack local arriba):
--   docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/hu05_originacion.sql

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Limpieza re-ejecutable de los DNIs de prueba (patrón HU-04)
-- ---------------------------------------------------------------------------
DELETE FROM public.cuotas
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('19191919','18181818','17171717','16161616','15151515','14141414')
);
-- HU-06: la evidencia de desembolso también referencia al préstamo.
DELETE FROM public.desembolsos
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('19191919','18181818','17171717','16161616','15151515','14141414')
);
DELETE FROM public.expedientes_extrajudicial
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('19191919','18181818','17171717','16161616','15151515','14141414')
);
DELETE FROM public.eventos_mora
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('19191919','18181818','17171717','16161616','15151515','14141414')
);
DELETE FROM public.prestamos
WHERE prestatario_id IN (
    SELECT pn.prestatario_id FROM public.personas_naturales pn
    WHERE pn.dni IN ('19191919','18181818','17171717','16161616','15151515','14141414')
);
DELETE FROM public.personas_naturales
WHERE dni IN ('19191919','18181818','17171717','16161616','15151515','14141414');

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NULL OR NOT p_cond THEN
        RAISE EXCEPTION 'FALLO: %', p_msg;
    END IF;
    RAISE NOTICE 'OK: %', p_msg;
END;
$$;

CREATE FUNCTION pg_temp.crear_prestatario(p_dni text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO')
    RETURNING id INTO v_id;

    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    ) VALUES (
        v_id, p_dni, 'Prueba', 'Hu05', 'Cronograma', DATE '1990-01-01'
    );
    RETURN v_id;
END;
$$;

-- Cronograma de prueba válido para el servidor: n cuotas con capital repartido
-- (la última absorbe el centavo final) y un interés fijo; suma de capitales =
-- monto exacto, totales coherentes, números 1..n y vencimientos mensuales.
CREATE FUNCTION pg_temp.cronograma(p_monto numeric, p_plazo int, p_fecha date)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_capital numeric := round(p_monto / p_plazo, 2);
    v_total_capital numeric := 0;
    v_cuotas jsonb := '[]'::jsonb;
    v_interes numeric := round(p_monto * 0.0221, 2);
    v_cap numeric;
    v_num int;
BEGIN
    FOR v_num IN 1..p_plazo LOOP
        IF v_num = p_plazo THEN
            v_cap := p_monto - v_total_capital;
        ELSE
            v_cap := v_capital;
        END IF;
        v_total_capital := v_total_capital + v_cap;
        v_cuotas := v_cuotas || jsonb_build_array(jsonb_build_object(
            'numero', v_num,
            'vencimiento', to_char(p_fecha + make_interval(months => v_num), 'YYYY-MM-DD'),
            'capital', v_cap,
            'interes', v_interes,
            'total', v_cap + v_interes
        ));
    END LOOP;
    RETURN v_cuotas;
END;
$$;

-- ---------------------------------------------------------------------------
-- S1 (CP-09): montos inválidos rechazados; 0.01 aceptado (CA-13)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v_cron jsonb;
BEGIN
    v_p := pg_temp.crear_prestatario('19191919');

    v := public.originar_prestamo(v_p, 0, 12, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s1-monto-cero', pg_temp.cronograma(0, 12, CURRENT_DATE));
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'MONTO_INVALIDO',
        'S1 (CP-09): monto 0 -> MONTO_INVALIDO');

    v := public.originar_prestamo(v_p, -50, 12, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s1-monto-neg', pg_temp.cronograma(100, 12, CURRENT_DATE));
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'MONTO_INVALIDO',
        'S1 (CP-09): monto negativo -> MONTO_INVALIDO');

    v_cron := pg_temp.cronograma(0.01, 1, CURRENT_DATE);
    v := public.originar_prestamo(v_p, 0.01, 1, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s1-monto-min', v_cron);
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S1 (CP-09): monto 0.01 aceptado');
    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.cuotas WHERE prestamo_id = (v->>'prestamo_id')::uuid) = 1,
        'S1: 1 cuota generada');
END $$;

-- ---------------------------------------------------------------------------
-- S2 (CP-08): plazos frontera 0/61 rechazados; 1 y 60 aceptados (RN-07)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v_p60 uuid;
BEGIN
    v_p := pg_temp.crear_prestatario('18181818');

    v := public.originar_prestamo(v_p, 500, 0, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s2-plazo-cero', pg_temp.cronograma(500, 1, CURRENT_DATE));
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'PLAZO_INVALIDO',
        'S2 (CP-08): plazo 0 -> PLAZO_INVALIDO');

    v := public.originar_prestamo(v_p, 500, 61, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s2-plazo-61', pg_temp.cronograma(500, 61, CURRENT_DATE));
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'PLAZO_INVALIDO',
        'S2 (CP-08): plazo 61 -> PLAZO_INVALIDO');

    v := public.originar_prestamo(v_p, 500, 1, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s2-plazo-1', pg_temp.cronograma(500, 1, CURRENT_DATE));
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S2 (CP-08): plazo 1 aceptado');

    v := public.originar_prestamo(v_p, 800, 60, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s2-plazo-60', pg_temp.cronograma(800, 60, CURRENT_DATE));
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S2 (CP-08): plazo 60 aceptado');
    v_p60 := (v->>'prestamo_id')::uuid;

    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.cuotas WHERE prestamo_id = v_p60) = 60,
        'S2: 60 cuotas para plazo 60');
END $$;

-- ---------------------------------------------------------------------------
-- S3: fecha de originación futura rechazada (5.4.1)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('17171717');
    v := public.originar_prestamo(v_p, 100, 6, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE + 1, NULL, 'hu05-s3-fecha-futura', pg_temp.cronograma(100, 6, CURRENT_DATE));
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'FECHA_INVALIDA',
        'S3: fecha futura -> FECHA_INVALIDA');
END $$;

-- ---------------------------------------------------------------------------
-- S4 (CA-14/5.2): cronograma con invariantes rotos rechazado (CRONOGRAMA_INVALIDO)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v_tru uuid; v_cron jsonb; v_mal jsonb;
BEGIN
    v_p := pg_temp.crear_prestatario('16161616');
    v_tru := (SELECT id FROM public.sucursales WHERE codigo='TRU');

    -- Conteo distinto al plazo.
    v_cron := pg_temp.cronograma(600, 5, CURRENT_DATE);
    v := public.originar_prestamo(v_p, 600, 6, v_tru, CURRENT_DATE, NULL, 'hu05-s4-count', v_cron);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'CRONOGRAMA_INVALIDO',
        'S4: cuotas != plazo -> CRONOGRAMA_INVALIDO');

    -- Suma de capitales != principal (fuerza 0.10 de diferencia).
    v_mal := '[]'::jsonb;
    FOR i IN 1..5 LOOP
        v_mal := v_mal || jsonb_build_array(jsonb_build_object(
            'numero', i,
            'vencimiento', to_char(CURRENT_DATE + make_interval(months => i), 'YYYY-MM-DD'),
            'capital', 100.00, 'interes', 5.00, 'total', 105.00));
    END LOOP;
    v := public.originar_prestamo(v_p, 600, 5, v_tru, CURRENT_DATE, NULL, 'hu05-s4-suma', v_mal);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'CRONOGRAMA_INVALIDO',
        'S4: sum(capitales) != principal -> CRONOGRAMA_INVALIDO');

    -- Números no consecutivos desde 1.
    v_mal := '[]'::jsonb;
    FOR i IN 2..5 LOOP
        v_mal := v_mal || jsonb_build_array(jsonb_build_object(
            'numero', i,
            'vencimiento', to_char(CURRENT_DATE + make_interval(months => i), 'YYYY-MM-DD'),
            'capital', 120.00, 'interes', 5.00, 'total', 125.00));
    END LOOP;
    v := public.originar_prestamo(v_p, 600, 4, v_tru, CURRENT_DATE, NULL, 'hu05-s4-numeros', v_mal);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'CRONOGRAMA_INVALIDO',
        'S4: números no 1..n -> CRONOGRAMA_INVALIDO');

    -- total != capital + interés.
    v_mal := jsonb_build_array(jsonb_build_object(
        'numero', 1, 'vencimiento', to_char(CURRENT_DATE + 30, 'YYYY-MM-DD'),
        'capital', 100.00, 'interes', 5.00, 'total', 105.01));
    v := public.originar_prestamo(v_p, 100, 1, v_tru, CURRENT_DATE, NULL, 'hu05-s4-total', v_mal);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'CRONOGRAMA_INVALIDO',
        'S4: total != capital+interes -> CRONOGRAMA_INVALIDO');

    -- Vencimiento <= fecha de originación.
    v_mal := jsonb_build_array(jsonb_build_object(
        'numero', 1, 'vencimiento', to_char(CURRENT_DATE, 'YYYY-MM-DD'),
        'capital', 100.00, 'interes', 5.00, 'total', 105.00));
    v := public.originar_prestamo(v_p, 100, 1, v_tru, CURRENT_DATE, NULL, 'hu05-s4-venc', v_mal);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'CRONOGRAMA_INVALIDO',
        'S4: vencimiento <= originación -> CRONOGRAMA_INVALIDO');
END $$;

-- ---------------------------------------------------------------------------
-- S5 (CA-14/RN-16/17): originación feliz — préstamo + cuotas coherentes
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v_plazo uuid; v_eleg JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('15151515');
    v_plazo := (SELECT id FROM public.sucursales WHERE codigo='TRU');

    v := public.originar_prestamo(v_p, 2500.00, 12, v_plazo,
        CURRENT_DATE, NULL, 'hu05-s5-feliz', pg_temp.cronograma(2500.00, 12, CURRENT_DATE));
    PERFORM pg_temp.assert((v->>'ok')::boolean AND NOT (v->>'idempotente')::boolean,
        'S5: originación ok, no idempotente');

    -- RN-16/17: préstamo con fecha y estado correctos; reserva liberada a 0 por reserva_capital.
    PERFORM pg_temp.assert(
        (SELECT estado FROM public.prestamos WHERE id = (v->>'prestamo_id')::uuid) = 'PENDIENTE_DESEMBOLSO',
        'S5: estado PENDIENTE_DESEMBOLSO (CA-15: sin deuda activa)');
    PERFORM pg_temp.assert(
        (SELECT reserva_capital FROM public.prestamos WHERE id = (v->>'prestamo_id')::uuid) = 2500.00,
        'S5: reserva_capital = principal (RN-09)');
    PERFORM pg_temp.assert(
        (SELECT fecha_originacion FROM public.prestamos WHERE id = (v->>'prestamo_id')::uuid) = CURRENT_DATE,
        'S5: fecha_originacion registrada (RN-16)');

    -- Cronograma: 12 cuotas PENDIENTE, sumas coherentes.
    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.cuotas WHERE prestamo_id = (v->>'prestamo_id')::uuid) = 12,
        'S5: 12 cuotas');
    PERFORM pg_temp.assert(
        (SELECT abs(sum(capital_programado) - 2500.00) FROM public.cuotas
         WHERE prestamo_id = (v->>'prestamo_id')::uuid) < 0.01,
        'S5: sum(capitales) = principal (5.7.1)');
    PERFORM pg_temp.assert(
        (SELECT bool_and(total_programado = capital_programado + interes_programado)
         FROM public.cuotas WHERE prestamo_id = (v->>'prestamo_id')::uuid),
        'S5: total = capital + interes en todas las cuotas (RN-17)');
    PERFORM pg_temp.assert(
        (SELECT bool_and(estado = 'PENDIENTE') FROM public.cuotas
         WHERE prestamo_id = (v->>'prestamo_id')::uuid),
        'S5: todas las cuotas PENDIENTE al originar (5.2.3)');
    PERFORM pg_temp.assert(
        (SELECT min(vencimiento) > CURRENT_DATE FROM public.cuotas
         WHERE prestamo_id = (v->>'prestamo_id')::uuid),
        'S5: vencimientos posteriores a la originación');

    -- La reserva consume el cupo global (HU-04 sigue operativa).
    v_eleg := public.evaluar_elegibilidad(v_p, NULL);
    PERFORM pg_temp.assert((v_eleg->>'ocupado')::numeric = 2500.00,
        'S5: ocupado = 2500 tras originar (RN-09)');
END $$;

-- ---------------------------------------------------------------------------
-- S6 (CP-28/CA-15/RN-31): doble envío idempotente crea un solo préstamo
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v2 JSONB; v_prestamo uuid; v_cron jsonb;
BEGIN
    v_p := pg_temp.crear_prestatario('14141414');
    v_cron := pg_temp.cronograma(1500.00, 6, CURRENT_DATE);

    v := public.originar_prestamo(v_p, 1500.00, 6, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s6-idem-key', v_cron);
    PERFORM pg_temp.assert((v->>'ok')::boolean AND NOT (v->>'idempotente')::boolean,
        'S6: primer envío crea el préstamo');
    v_prestamo := (v->>'prestamo_id')::uuid;

    v2 := public.originar_prestamo(v_p, 1500.00, 6, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s6-idem-key', v_cron);
    PERFORM pg_temp.assert((v2->>'ok')::boolean AND (v2->>'idempotente')::boolean,
        'S6 (CP-28): segundo envío idempotente');
    PERFORM pg_temp.assert((v2->>'prestamo_id')::uuid = v_prestamo, 'S6: mismo préstamo devuelto');

    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.prestamos WHERE idempotency_key = 'hu05-s6-idem-key') = 1,
        'S6 (CP-28): un solo préstamo para la clave');
    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.cuotas WHERE prestamo_id = v_prestamo) = 6,
        'S6 (CP-28): las cuotas no se duplican');
END $$;

-- ---------------------------------------------------------------------------
-- S7 (CP-11): cupo agotado — originación rechazada y sin residuos (CA-15 atómico)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v_cron jsonb;
BEGIN
    v_p := pg_temp.crear_prestatario('13131313');
    -- Ocupa el 100 % del cupo con una reserva HU-04 directa (sin cuotas).
    PERFORM public.reservar_cupo(v_p, 10000.00, 24,
        (SELECT id FROM public.sucursales WHERE codigo='TRU'), NULL, 'hu05-s7-cupo-full');

    v_cron := pg_temp.cronograma(500.00, 6, CURRENT_DATE);
    v := public.originar_prestamo(v_p, 500.00, 6, (SELECT id FROM public.sucursales WHERE codigo='TRU'),
        CURRENT_DATE, NULL, 'hu05-s7-rechazado', v_cron);
    PERFORM pg_temp.assert(
        NOT (v->>'ok')::boolean AND v->>'motivo' = 'CUPO_INSUFICIENTE',
        'S7 (CP-11): cupo 0 -> CUPO_INSUFICIENTE');
    -- Atomicidad (CA-15): el rechazo no deja residuos.
    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.prestamos WHERE idempotency_key = 'hu05-s7-rechazado') = 0,
        'S7: sin préstamo residual tras el rechazo');
    PERFORM pg_temp.assert(
        (SELECT count(*) FROM public.cuotas WHERE prestamo_id IN (
            SELECT id FROM public.prestamos WHERE prestatario_id = v_p)) = 0,
        'S7: sin cuotas residuales tras el rechazo');
END $$;

ROLLBACK;
