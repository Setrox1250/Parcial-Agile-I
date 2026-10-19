-- HU-08: mora y expediente extrajudicial.
-- CP-21..CP-25; RN-15, RN-26..RN-29, RN-37 y RN-38.
-- Ejecutar (stack local arriba):
--   docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/hu08_mora.sql

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM public.pagos_imputaciones
WHERE pago_id IN (
    SELECT pa.id FROM public.pagos pa
    JOIN public.prestamos pr ON pr.id = pa.prestamo_id
    JOIN public.personas_naturales pn ON pn.prestatario_id = pr.prestatario_id
    WHERE pn.dni IN ('70707070', '71717171', '72727272')
);
DELETE FROM public.pagos
WHERE prestamo_id IN (
    SELECT pr.id FROM public.prestamos pr
    JOIN public.personas_naturales pn ON pn.prestatario_id = pr.prestatario_id
    WHERE pn.dni IN ('70707070', '71717171', '72727272')
);
DELETE FROM public.expedientes_extrajudicial
WHERE prestamo_id IN (
    SELECT pr.id FROM public.prestamos pr
    JOIN public.personas_naturales pn ON pn.prestatario_id = pr.prestatario_id
    WHERE pn.dni IN ('70707070', '71717171', '72727272')
);
DELETE FROM public.eventos_mora
WHERE prestamo_id IN (
    SELECT pr.id FROM public.prestamos pr
    JOIN public.personas_naturales pn ON pn.prestatario_id = pr.prestatario_id
    WHERE pn.dni IN ('70707070', '71717171', '72727272')
);
DELETE FROM public.cuotas
WHERE prestamo_id IN (
    SELECT pr.id FROM public.prestamos pr
    JOIN public.personas_naturales pn ON pn.prestatario_id = pr.prestatario_id
    WHERE pn.dni IN ('70707070', '71717171', '72727272')
);
DELETE FROM public.prestamos
WHERE prestatario_id IN (
    SELECT prestatario_id FROM public.personas_naturales
    WHERE dni IN ('70707070', '71717171', '72727272')
);
DELETE FROM public.personas_naturales WHERE dni IN ('70707070', '71717171', '72727272');
DELETE FROM public.prestatarios
WHERE id NOT IN (SELECT prestatario_id FROM public.personas_naturales)
  AND id NOT IN (SELECT prestatario_id FROM public.empresas)
  AND id NOT IN (SELECT prestatario_id FROM public.prestamos);

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NULL OR NOT p_cond THEN
        RAISE EXCEPTION 'FALLO: %', p_msg;
    END IF;
    RAISE NOTICE 'OK: %', p_msg;
END;
$$;

CREATE FUNCTION pg_temp.crear_prestamo_activo(p_dni text, p_vencimiento date)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_prestatario uuid; v_prestamo uuid;
BEGIN
    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO') RETURNING id INTO v_prestatario;
    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    ) VALUES (
        v_prestatario, p_dni, 'Prueba', 'HU08', 'Mora', DATE '1990-01-01'
    );
    INSERT INTO public.prestamos (
        prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital,
        tea, plazo_meses, estado, fecha_originacion, desembolsado_en
    ) VALUES (
        v_prestatario, (SELECT id FROM public.sucursales WHERE codigo = 'TRU'),
        100, 100, 0, 0.30, 2, 'ACTIVO', p_vencimiento - 1, now()
    ) RETURNING id INTO v_prestamo;
    INSERT INTO public.cuotas (
        prestamo_id, numero, vencimiento, capital_programado, interes_programado, total_programado
    ) VALUES
        (v_prestamo, 1, p_vencimiento, 50, 0, 50),
        (v_prestamo, 2, p_vencimiento + 30, 50, 0, 50);
    RETURN v_prestamo;
END;
$$;

-- CP-21/CP-22: el día del vencimiento no hay mora; al siguiente se abre una
-- racha y la elegibilidad global queda bloqueada.
DO $$
DECLARE v_pl uuid; v jsonb; v_eval jsonb;
BEGIN
    v_pl := pg_temp.crear_prestamo_activo('70707070', DATE '2026-07-09');
    v := public.sincronizar_mora_prestamo(v_pl, DATE '2026-07-09');
    PERFORM pg_temp.assert(v->>'accion' = 'SIN_MORA', 'S1 (CP-21): el día de vencimiento no es mora');

    v := public.sincronizar_mora_prestamo(v_pl, DATE '2026-07-10');
    PERFORM pg_temp.assert(v->>'accion' = 'ABIERTA', 'S1 (CP-22): al día siguiente abre la racha');
    PERFORM pg_temp.assert((v->>'inicio_mora')::date = DATE '2026-07-10',
        'S1: inicio_mora es el primer día posterior al vencimiento');
    PERFORM pg_temp.assert((v->>'monto_vencido')::numeric = 50, 'S1: conserva el saldo vencido exacto');

    SELECT public.evaluar_elegibilidad(pr.prestatario_id, 1) INTO v_eval
    FROM public.prestamos pr WHERE pr.id = v_pl;
    PERFORM pg_temp.assert(v_eval->>'motivo' = 'MOROSO' AND NOT (v_eval->>'elegible')::boolean,
        'S1 (CA-22/RN-15): mora bloquea crédito en toda la empresa');
END $$;

-- CP-24: un pago confirmado e imputado regulariza de inmediato la deuda
-- vencida, cierra la racha y libera el bloqueo MOROSO.
DO $$
DECLARE v_pl uuid; v_pago uuid; v_evento uuid; v_eval jsonb;
BEGIN
    SELECT pr.id, em.id INTO v_pl, v_evento
    FROM public.prestamos pr
    JOIN public.personas_naturales pn ON pn.prestatario_id = pr.prestatario_id
    JOIN public.eventos_mora em ON em.prestamo_id = pr.id AND em.fecha_fin IS NULL
    WHERE pn.dni = '70707070';

    INSERT INTO public.pagos (
        prestamo_id, monto, medio, estado, confirmado_en
    ) VALUES (v_pl, 100, 'EFECTIVO', 'CONFIRMADO', now()) RETURNING id INTO v_pago;
    INSERT INTO public.pagos_imputaciones (pago_id, cuota_id, importe_capital, importe_interes)
    SELECT v_pago, id, 50, 0 FROM public.cuotas WHERE prestamo_id = v_pl;
    UPDATE public.pagos SET imputado_en = now() WHERE id = v_pago;

    PERFORM pg_temp.assert((SELECT fecha_fin IS NOT NULL FROM public.eventos_mora WHERE id = v_evento),
        'S2 (CP-24): el trigger de imputación cierra la racha regularizada');
    SELECT public.evaluar_elegibilidad(pr.prestatario_id, 1) INTO v_eval
    FROM public.prestamos pr WHERE pr.id = v_pl;
    PERFORM pg_temp.assert((v_eval->>'elegible')::boolean,
        'S2: sin mora ni expediente abierto se libera el bloqueo de originación');
END $$;

-- CP-23/CP-25: una racha abierta un año calendario genera exactamente un
-- expediente; volver a procesar no duplica el histórico ni altera la deuda.
DO $$
DECLARE v_pl uuid; v jsonb; v_evento uuid; v_n integer;
BEGIN
    v_pl := pg_temp.crear_prestamo_activo('71717171', DATE '2025-01-09');
    v := public.procesar_mora(DATE '2025-01-10');
    PERFORM pg_temp.assert((v->>'moras_abiertas')::integer >= 1, 'S3: procesador diario abre la mora');
    SELECT id INTO v_evento FROM public.eventos_mora WHERE prestamo_id = v_pl AND fecha_fin IS NULL;

    v := public.procesar_mora(DATE '2026-01-10');
    PERFORM pg_temp.assert(EXISTS (
        SELECT 1 FROM public.expedientes_extrajudicial WHERE evento_mora_id = v_evento
    ), 'S3 (CP-23): al aniversario se crea un expediente');
    PERFORM pg_temp.assert((SELECT fecha_escalamiento = DATE '2026-01-10'
        FROM public.expedientes_extrajudicial WHERE evento_mora_id = v_evento),
        'S3: la fecha de escalamiento conserva el aniversario de la racha');
    PERFORM pg_temp.assert((SELECT estado = 'ACTIVO' FROM public.prestamos WHERE id = v_pl),
        'S3 (CP-25): escalar no borra ni liquida la deuda');

    v := public.procesar_mora(DATE '2026-01-11');
    SELECT COUNT(*) INTO v_n FROM public.expedientes_extrajudicial WHERE evento_mora_id = v_evento;
    PERFORM pg_temp.assert(v_n = 1,
        'S3: reprocesar es idempotente y no duplica expediente');
END $$;

-- Protección de datos: las tablas siguen cerradas y los RPC no son públicos.
DO $$
BEGIN
    PERFORM pg_temp.assert(
        NOT has_function_privilege('anon', 'public.procesar_mora(date)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.procesar_mora(date)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.procesar_mora(date)', 'EXECUTE'),
        'S4 (CA-30): procesar_mora solo es ejecutable por service_role');
    PERFORM pg_temp.assert(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.expedientes_extrajudicial'::regclass),
        'S4: RLS permanece habilitada en expedientes');
    PERFORM pg_temp.assert(
        EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'procesar-mora-diaria-lima'),
        'S4 (RN-38): existe la ejecución diaria programada');
END $$;

-- El cron y el reproceso manual pasan por una envoltura con reintentos y un
-- registro operativo, sin abrir acceso directo a anon/authenticated.
DO $$
DECLARE v jsonb; v_ejecucion uuid;
BEGIN
    v := public.procesar_mora_con_reintentos(DATE '2026-01-11', 3::smallint);
    v_ejecucion := (v->>'ejecucion_id')::uuid;
    PERFORM pg_temp.assert((v->>'ok')::boolean AND (v->>'intentos')::integer = 1,
        'S5: proceso de mora exitoso queda registrado en el primer intento');
    PERFORM pg_temp.assert(EXISTS (
        SELECT 1 FROM public.ejecuciones_mora
        WHERE ejecucion_id = v_ejecucion AND intento = 1 AND estado = 'EXITOSO'
    ), 'S5: el log conserva resultado y fecha operativa de la ejecución');
    PERFORM pg_temp.assert(
        NOT has_function_privilege('anon', 'public.procesar_mora_con_reintentos(date,smallint)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.procesar_mora_con_reintentos(date,smallint)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.procesar_mora_con_reintentos(date,smallint)', 'EXECUTE'),
        'S5: el reproceso con reintentos solo es ejecutable por service_role');
    PERFORM pg_temp.assert(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ejecuciones_mora'::regclass),
        'S5: RLS permanece habilitada en el log de ejecuciones');
    PERFORM pg_temp.assert(EXISTS (
        SELECT 1 FROM cron.job
        WHERE jobname = 'procesar-mora-diaria-lima'
          AND command LIKE '%procesar_mora_con_reintentos%'
    ), 'S5: el cron diario usa la envoltura con reintentos');
END $$;

COMMIT;

SELECT 'HU08: TODAS LAS PRUEBAS SQL PASARON' AS resultado;
