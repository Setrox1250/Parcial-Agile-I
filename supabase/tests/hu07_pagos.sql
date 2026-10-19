-- HU-07: pruebas SQL de pagos (registro, verificación, idempotencia,
-- inmutabilidad y privilegios). Incluye imputación a cuotas (S12): proceso
-- PARCIAL/PAGADA, capital/interés, capital_insoluto y préstamo PAGADO
-- (CP-12/CP-13, RN-11/RN-25) sobre préstamos CON cuotas.
--
-- Ejecutar (stack local arriba):
--   docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/hu07_pagos.sql

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Limpieza re-ejecutable de los DNIs de prueba de esta suite
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE 'hu07-test%';
DELETE FROM public.pagos_imputaciones
WHERE pago_id IN (
    SELECT pg.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    JOIN public.pagos pg ON pg.prestamo_id = p.id
    WHERE pn.dni IN ('18181818','19191919','23232323','24242424','25252525','26262626','27272727','28282828','81818181')
);
DELETE FROM public.pagos
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('18181818','19191919','23232323','24242424','25252525','26262626','27272727','28282828','81818181')
);
DELETE FROM public.cuotas
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('18181818','19191919','23232323','24242424','25252525','26262626','27272727','28282828','81818181')
);
DELETE FROM public.desembolsos
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('18181818','19191919','23232323','24242424','25252525','26262626','27272727','28282828','81818181')
);
DELETE FROM public.prestamos
WHERE prestatario_id IN (
    SELECT pn.prestatario_id FROM public.personas_naturales pn
    WHERE pn.dni IN ('18181818','19191919','23232323','24242424','25252525','26262626','27272727','28282828','81818181')
);
DELETE FROM public.personas_naturales
WHERE dni IN ('18181818','19191919','23232323','24242424','25252525','26262626','27272727','28282828','81818181');
DELETE FROM public.prestatarios
WHERE id NOT IN (SELECT prestatario_id FROM public.personas_naturales)
  AND id NOT IN (SELECT prestatario_id FROM public.empresas)
  AND id NOT IN (SELECT prestatario_id FROM public.prestamos);

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

-- Usuario de auth mínimo para probar el registro de actor (CA-28)
CREATE FUNCTION pg_temp.crear_usuario(p_email text DEFAULT 'hu07-test-a@parcial.local') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated', 'authenticated', p_email,
        crypt('password-de-prueba', gen_salt('bf')), now(), now(), now()
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Crea un prestatario de prueba con su préstamo directamente en estado ACTIVO
-- (esta rama puede correr antes del desembolso de HU-06).
CREATE FUNCTION pg_temp.crear_activo(p_dni text, p_sucursal text, p_principal numeric)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_p uuid; v_pl uuid;
BEGIN
    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO')
    RETURNING id INTO v_p;

    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    ) VALUES (v_p, p_dni, 'Prueba', 'Hu07', 'Pagos', DATE '1990-01-01');

    INSERT INTO public.prestamos (
        prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital,
        tea, plazo_meses, estado, desembolsado_en
    ) VALUES (
        v_p, (SELECT id FROM public.sucursales WHERE codigo = p_sucursal),
        p_principal, p_principal, 0, 0.30, 12, 'ACTIVO', now()
    ) RETURNING id INTO v_pl;
    RETURN v_pl;
END;
$$;

-- Préstamo ACTIVO CON cronograma (2 cuotas) para probar imputación real.
CREATE FUNCTION pg_temp.crear_activo_con_cuotas(p_dni text, p_sucursal text, p_principal numeric)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_pl uuid; v_cap1 numeric; v_cap2 numeric; v_int numeric := 50.00;
BEGIN
    v_pl := pg_temp.crear_activo(p_dni, p_sucursal, p_principal);
    v_cap1 := round(p_principal / 2, 2);
    v_cap2 := p_principal - v_cap1;
    INSERT INTO public.cuotas (prestamo_id, numero, vencimiento, capital_programado, interes_programado, total_programado, estado)
    SELECT v_pl, t.numero, CURRENT_DATE + make_interval(months => t.numero), t.cap, v_int, t.cap + v_int, 'PENDIENTE'
    FROM (VALUES (1, v_cap1), (2, v_cap2)) AS t(numero, cap);
    RETURN v_pl;
END;
$$;

-- ---------------------------------------------------------------------------
-- S1 (CA-18, RN-08): validación de monto, medio y referencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid; v JSONB;
BEGIN
    v_pl := pg_temp.crear_activo('18181818', 'TRU', 1000);

    v := public.registrar_pago(v_pl, 0, 'EFECTIVO', NULL, NULL, NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'MONTO_INVALIDO',
        'S1: monto 0 -> MONTO_INVALIDO');

    v := public.registrar_pago(v_pl, -50, 'EFECTIVO', NULL, NULL, NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'MONTO_INVALIDO',
        'S1: monto negativo -> MONTO_INVALIDO');

    v := public.registrar_pago(v_pl, 100, 'CHEQUE', NULL, NULL, NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'MEDIO_INVALIDO',
        'S1: medio CHEQUE -> MEDIO_INVALIDO');

    v := public.registrar_pago(v_pl, 100, 'TRANSFERENCIA', NULL, NULL, NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'REFERENCIA_REQUERIDA',
        'S1 (§4.3.5): transferencia sin referencia -> REFERENCIA_REQUERIDA');
END $$;

-- ---------------------------------------------------------------------------
-- S2 (CA-26): préstamo inexistente
-- ---------------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
    v := public.registrar_pago(gen_random_uuid(), 100, 'EFECTIVO', NULL, NULL, NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'PRESTAMO_INEXISTENTE',
        'S2: préstamo inexistente -> PRESTAMO_INEXISTENTE');
END $$;

-- ---------------------------------------------------------------------------
-- S3 (CA-18): solo se cobra sobre un préstamo desembolsado (ACTIVO)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v_pl uuid; v JSONB;
BEGIN
    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO') RETURNING id INTO v_p;
    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    ) VALUES (v_p, '19191919', 'Prueba', 'Hu07', 'Pagos', DATE '1990-01-01');
    INSERT INTO public.prestamos (
        prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital,
        tea, plazo_meses, estado
    ) VALUES (
        v_p, (SELECT id FROM public.sucursales WHERE codigo = 'CHI'),
        500, 0, 500, 0.30, 12, 'PENDIENTE_DESEMBOLSO'
    ) RETURNING id INTO v_pl;

    v := public.registrar_pago(v_pl, 50, 'EFECTIVO', NULL, NULL, NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'PRESTAMO_NO_ACTIVO',
        'S3: cobro sobre PENDIENTE_DESEMBOLSO -> PRESTAMO_NO_ACTIVO');
    PERFORM pg_temp.assert((SELECT COUNT(*) FROM public.pagos WHERE prestamo_id = v_pl) = 0,
        'S3: el cobro rechazado no creó pago');
END $$;

-- ---------------------------------------------------------------------------
-- S4 (§4.3.5, CA-16): el efectivo se confirma al registrarlo, sin referencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid; v JSONB; v_id uuid; v_est text; v_conf boolean; v_misma boolean; v_ref text;
BEGIN
    v_pl := pg_temp.crear_activo('23232323', 'TRU', 2000);

    v := public.registrar_pago(v_pl, 150.50, 'EFECTIVO', 'REF-NO-DEBE-QUEDAR', NULL, 'hu07-s4-efectivo');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S4: efectivo registrado');
    v_id := (v->>'pago_id')::uuid;
    PERFORM pg_temp.assert(v->>'estado' = 'CONFIRMADO', 'S4: efectivo -> CONFIRMADO directo');

    SELECT estado, confirmado_en IS NOT NULL,
           registra IS NOT DISTINCT FROM confirma, referencia
      INTO v_est, v_conf, v_misma, v_ref
    FROM public.pagos WHERE id = v_id;

    PERFORM pg_temp.assert(v_est = 'CONFIRMADO', 'S4: estado persistido CONFIRMADO');
    PERFORM pg_temp.assert(v_conf, 'S4: confirmado_en con fecha (CA-27)');
    PERFORM pg_temp.assert(v_misma, 'S4: el que registra efectivo queda como confirmador (CA-16)');
    PERFORM pg_temp.assert(v_ref IS NULL, 'S4: el efectivo no guarda referencia');
    PERFORM pg_temp.assert((SELECT COUNT(*) FROM public.pagos WHERE idempotency_key = 'hu07-s4-efectivo') = 1,
        'S4: un solo pago con la idempotency_key (RN-31)');
    PERFORM pg_temp.assert((SELECT imputado_en IS NULL FROM public.pagos WHERE id = v_id),
        'S4: imputado_en NULL -> cobro por imputar (RN-11, espera HU-05)');
END $$;

-- ---------------------------------------------------------------------------
-- S5 (RN-23, §4.3.5): la transferencia espera verificación manual
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid; v JSONB; v_id uuid; v_est text; v_fecha timestamptz;
BEGIN
    v_pl := pg_temp.crear_activo('24242424', 'CBO', 1500);

    v := public.registrar_pago(v_pl, 300, 'TRANSFERENCIA', 'CCI-778899', NULL, NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S5: transferencia registrada');
    v_id := (v->>'pago_id')::uuid;
    PERFORM pg_temp.assert(v->>'estado' = 'PENDIENTE_VERIFICACION',
        'S5: transferencia -> PENDIENTE_VERIFICACION (RN-23)');

    SELECT estado, confirmado_en INTO v_est, v_fecha
    FROM public.pagos WHERE id = v_id;
    PERFORM pg_temp.assert(v_est = 'PENDIENTE_VERIFICACION' AND v_fecha IS NULL,
        'S5: sin fecha de confirmación hasta verificar (no altera saldos)');

    v := public.verificar_pago(v_id, 'CONFIRMAR', NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean AND v->>'estado' = 'CONFIRMADO',
        'S5: verificar CONFIRMAR -> CONFIRMADO (CA-27)');

    SELECT confirmado_en INTO v_fecha FROM public.pagos WHERE id = v_id;
    PERFORM pg_temp.assert(v_fecha IS NOT NULL, 'S5: confirmado_en marcado al verificar (CA-27)');

    v := public.verificar_pago(v_id, 'CONFIRMAR', NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'ESTADO_NO_VERIFICABLE',
        'S5 (RN-33): no se re-verifica un pago ya confirmado');

    v := public.verificar_pago(v_id, 'RECHAZAR', NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'ESTADO_NO_VERIFICABLE',
        'S5 (RN-33): un CONFIRMADO no se rechaza después');
END $$;

-- ---------------------------------------------------------------------------
-- S6 (CA-27/CA-28): rechazo de la transferencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid; v JSONB; v_id uuid; v_est text; v_fecha timestamptz;
        v_actor uuid; v_verificador uuid;
BEGIN
    v_pl := pg_temp.crear_activo('25252525', 'PIU', 800);
    v_actor := pg_temp.crear_usuario();
    v_verificador := pg_temp.crear_usuario('hu07-test-b@parcial.local');

    v := public.registrar_pago(v_pl, 200, 'TRANSFERENCIA', 'CCI-101010', v_actor, NULL);
    v_id := (v->>'pago_id')::uuid;

    v := public.verificar_pago(v_id, 'RECHAZAR', v_verificador);
    PERFORM pg_temp.assert((v->>'ok')::boolean AND v->>'estado' = 'RECHAZADO',
        'S6: verificar RECHAZAR -> RECHAZADO');

    SELECT estado, confirmado_en, confirma INTO v_est, v_fecha, v_actor
    FROM public.pagos WHERE id = v_id;

    PERFORM pg_temp.assert(v_est = 'RECHAZADO', 'S6: estado RECHAZADO persistido');
    PERFORM pg_temp.assert(v_fecha IS NOT NULL, 'S6: rechazo con fecha (CA-27)');
    PERFORM pg_temp.assert(v_actor IS NOT NULL AND v_actor = v_verificador,
        'S6: el que verifica queda como confirma con actor y fecha (CA-28)');
END $$;

-- ---------------------------------------------------------------------------
-- S7 (RN-31/CP-28): idempotencia por idempotency_key
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid; v1 JSONB; v2 JSONB; v_n int;
BEGIN
    v_pl := pg_temp.crear_activo('26262626', 'TUM', 600);

    v1 := public.registrar_pago(v_pl, 120, 'TRANSFERENCIA', 'CCI-555', NULL, 'hu07-s7-idem');
    v2 := public.registrar_pago(v_pl, 120, 'TRANSFERENCIA', 'CCI-555', NULL, 'hu07-s7-idem');

    PERFORM pg_temp.assert((v1->>'ok')::boolean AND NOT (v1->>'idempotente')::boolean,
        'S7: primer cobro no es idempotente');
    PERFORM pg_temp.assert((v2->>'ok')::boolean AND (v2->>'idempotente')::boolean,
        'S7: reenvío con la misma clave -> idempotente');
    PERFORM pg_temp.assert((v2->>'pago_id')::uuid = (v1->>'pago_id')::uuid,
        'S7: devuelve el mismo pago_id');

    SELECT COUNT(*) INTO v_n FROM public.pagos WHERE idempotency_key = 'hu07-s7-idem';
    PERFORM pg_temp.assert(v_n = 1, 'S7: un solo pago con la clave (RN-31)');
END $$;

-- ---------------------------------------------------------------------------
-- S8: verificación con pago o acción inválidos
-- ---------------------------------------------------------------------------
DO $$
DECLARE v JSONB; v_pl uuid; v_id uuid;
BEGIN
    v := public.verificar_pago(gen_random_uuid(), 'CONFIRMAR', NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'PAGO_INEXISTENTE',
        'S8: pago inexistente -> PAGO_INEXISTENTE (CA-26)');

    v_pl := pg_temp.crear_activo('27272727', 'TRU', 1000);
    v := public.registrar_pago(v_pl, 10, 'EFECTIVO', NULL, NULL, NULL);
    v_id := (v->>'pago_id')::uuid;

    v := public.verificar_pago(v_id, 'BORRAR', NULL);
    PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'motivo' = 'ACCION_INVALIDA',
        'S8: acción BORRAR -> ACCION_INVALIDA');
END $$;

-- ---------------------------------------------------------------------------
-- S9: invariantes CHECK de la tabla pagos (§5)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid;
BEGIN
    v_pl := pg_temp.crear_activo('28282828', 'TRU', 1000);

    BEGIN
        INSERT INTO public.pagos (prestamo_id, monto, medio, referencia, estado)
        VALUES (v_pl, 0, 'EFECTIVO', NULL, 'CONFIRMADO');
        RAISE EXCEPTION 'FALLO: monto 0 aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 monto <= 0 rechazado';
    END;

    BEGIN
        INSERT INTO public.pagos (prestamo_id, monto, medio, referencia, estado)
        VALUES (v_pl, 50, 'EFECTIVO', 'REF-X', 'CONFIRMADO');
        RAISE EXCEPTION 'FALLO: efectivo con referencia aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 efectivo con referencia rechazado';
    END;

    BEGIN
        INSERT INTO public.pagos (prestamo_id, monto, medio, referencia, estado)
        VALUES (v_pl, 50, 'TRANSFERENCIA', NULL, 'PENDIENTE_VERIFICACION');
        RAISE EXCEPTION 'FALLO: transferencia sin referencia aceptada';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 transferencia sin referencia rechazada';
    END;

    BEGIN
        INSERT INTO public.pagos (prestamo_id, monto, medio, referencia, estado)
        VALUES (v_pl, 50, 'EFECTIVO', NULL, 'PENDIENTE_VERIFICACION');
        RAISE EXCEPTION 'FALLO: efectivo pendiente de verificación aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 efectivo no puede quedar pendiente (§4.3.5)';
    END;

    BEGIN
        INSERT INTO public.pagos (prestamo_id, monto, medio, referencia, estado, confirmado_en)
        VALUES (v_pl, 50, 'TRANSFERENCIA', 'CCI-1', 'CONFIRMADO', NULL);
        RAISE EXCEPTION 'FALLO: CONFIRMADO sin fecha aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 CONFIRMADO exige confirmado_en (CA-27)';
    END;

    BEGIN
        INSERT INTO public.pagos (prestamo_id, monto, medio, referencia, estado, imputado_en)
        VALUES (v_pl, 50, 'EFECTIVO', NULL, 'CONFIRMADO', now());
        RAISE EXCEPTION 'FALLO: imputado_en sin imputación real aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 imputado_en solo sobre CONFIRMADO';
    END;
END $$;

-- ---------------------------------------------------------------------------
-- S10 (RN-33): el histórico de cobros es inmutable por SQL directo
--     (sin triggers: se verifica que el cliente no tenga privilegios sobre la
--      tabla y que el hecho quede solo en RPC de service_role)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM pg_temp.assert(
        NOT has_table_privilege('authenticated', 'public.pagos', 'INSERT')
        AND NOT has_table_privilege('authenticated', 'public.pagos', 'UPDATE')
        AND NOT has_table_privilege('authenticated', 'public.pagos', 'DELETE')
        AND NOT has_table_privilege('anon', 'public.pagos', 'INSERT')
        AND NOT has_table_privilege('anon', 'public.pagos', 'UPDATE')
        AND NOT has_table_privilege('anon', 'public.pagos', 'DELETE'),
        'S10 (RN-33): anon y authenticated no escriben ni borran pagos');
END $$;

-- ---------------------------------------------------------------------------
-- S11 (CA-30/RN-34): RPC solo para service_role, con RLS activa
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM pg_temp.assert(
        NOT has_function_privilege('anon', 'public.registrar_pago(uuid,numeric,text,text,uuid,text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.registrar_pago(uuid,numeric,text,text,uuid,text)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.registrar_pago(uuid,numeric,text,text,uuid,text)', 'EXECUTE'),
        'S11 (CA-30): registrar_pago solo service_role');

    PERFORM pg_temp.assert(
        NOT has_function_privilege('anon', 'public.verificar_pago(uuid,text,uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.verificar_pago(uuid,text,uuid)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.verificar_pago(uuid,text,uuid)', 'EXECUTE'),
        'S11 (CA-30): verificar_pago solo service_role');

    PERFORM pg_temp.assert(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pagos'::regclass),
        'S11: RLS habilitada en pagos');
END $$;

-- ---------------------------------------------------------------------------
-- S12 (CP-12/CP-13/CP-17, RN-11/RN-20/RN-25): imputación real sobre un
-- préstamo CON cuotas. Regresión del fix de cuota_id (uuid = text): antes de
-- castear, todo cobro imputable fallaba y dejaba pagos sin imputar.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_pl uuid; v JSONB; v_pago uuid; v_imp_cap numeric; v_imp_int numeric;
        v_est text; v_cap_ins numeric; v_est_prestamo text; v_n_imp int; v_ya JSONB;
BEGIN
    v_pl := pg_temp.crear_activo_con_cuotas('81818181', 'TRU', 1000);
    -- Cuotas: 1 = 500 cap + 50 int (total 550); 2 = 500 cap + 50 int (total 550)

    -- Pago 1: parcial a la cuota 1 (prioriza capital, RN-22)
    v := public.registrar_pago(v_pl, 120, 'EFECTIVO', NULL, NULL, 'hu07-s12-p1');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S12: efectivo imputable registrado sin error');
    v_pago := (v->>'pago_id')::uuid;

    PERFORM pg_temp.assert(
        (SELECT imputado_en IS NOT NULL FROM public.pagos WHERE id = v_pago),
        'S12: pago imputado (imputado_en marcado)');

    SELECT t.total_capital, t.total_interes
      INTO v_imp_cap, v_imp_int
      FROM public.cuotas_totales_imputados t
      JOIN public.cuotas c ON c.id = t.cuota_id
     WHERE c.prestamo_id = v_pl AND c.numero = 1;
    PERFORM pg_temp.assert(v_imp_cap = 120 AND v_imp_int = 0,
        'S12: cuota 1 abonada 120 capital / 0 interés (RN-22)');

    SELECT estado INTO v_est FROM public.cuotas WHERE prestamo_id = v_pl AND numero = 1;
    PERFORM pg_temp.assert(v_est = 'PARCIAL', 'S12: cuota 1 PARCIAL (RN-20)');

    SELECT COUNT(*) INTO v_n_imp FROM public.pagos_imputaciones WHERE pago_id = v_pago;
    PERFORM pg_temp.assert(v_n_imp = 1, 'S12: una imputación registrada');

    SELECT capital_insoluto, estado INTO v_cap_ins, v_est_prestamo
      FROM public.prestamos WHERE id = v_pl;
    PERFORM pg_temp.assert(v_cap_ins = 880 AND v_est_prestamo = 'ACTIVO',
        'S12: capital_insoluto 880 y préstamo sigue ACTIVO (RN-11)');

    -- Re-llamada idempotente de la imputación (CP-13)
    v_ya := public.imputar_pago_confirmado(v_pago);
    PERFORM pg_temp.assert((v_ya->>'ok')::boolean AND (v_ya->>'idempotente')::boolean,
        'S12: re-imputar es idempotente (YA_IMPUTADO)');

    -- Pago 2: cubre el resto de la cuota 1 (550 - 120 = 430) -> PAGADA
    v := public.registrar_pago(v_pl, 430, 'EFECTIVO', NULL, NULL, 'hu07-s12-p2');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S12: segundo efectivo registrado');
    SELECT estado INTO v_est FROM public.cuotas WHERE prestamo_id = v_pl AND numero = 1;
    PERFORM pg_temp.assert(v_est = 'PAGADA', 'S12: cuota 1 PAGADA al cubrirse (RN-20)');
    SELECT estado INTO v_est FROM public.cuotas WHERE prestamo_id = v_pl AND numero = 2;
    PERFORM pg_temp.assert(v_est = 'PENDIENTE', 'S12: cuota 2 intacta (orden antiguo primero)');
    SELECT capital_insoluto INTO v_cap_ins FROM public.prestamos WHERE id = v_pl;
    PERFORM pg_temp.assert(v_cap_ins = 500, 'S12: capital_insoluto 500 tras amortizar 380');

    -- Pago 3: cubre la cuota 2 completa -> préstamo PAGADO (RN-25)
    v := public.registrar_pago(v_pl, 550, 'EFECTIVO', NULL, NULL, 'hu07-s12-p3');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S12: tercer efectivo registrado');
    SELECT estado, capital_insoluto INTO v_est_prestamo, v_cap_ins
      FROM public.prestamos WHERE id = v_pl;
    PERFORM pg_temp.assert(v_est_prestamo = 'PAGADO' AND v_cap_ins = 0,
        'S12: préstamo PAGADO con capital_insoluto 0 (RN-25/CP-26)');
    PERFORM pg_temp.assert(
        (SELECT COUNT(*) FROM public.cuotas WHERE prestamo_id = v_pl AND estado = 'PAGADA') = 2,
        'S12: las 2 cuotas PAGADAS');
END $$;

COMMIT;

SELECT 'HU07: TODAS LAS PRUEBAS SQL PASARON' AS resultado;
