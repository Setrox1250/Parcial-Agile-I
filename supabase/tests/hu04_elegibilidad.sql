-- HU-04: pruebas de exposición, elegibilidad, cupo y bloqueos (CP-11, CP-14,
-- CP-15, RN-05/09/10/13/14/15/28/32). CP-12/CP-13 (pago libera cupo) quedan
-- para HU-07. Concurrencia CP-16: ver hu04_concurrencia.sh.
--
-- Ejecutar (stack local arriba):
--   docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/hu04_elegibilidad.sql

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Limpieza re-ejecutable de los DNIs de prueba
-- (HU-03: el detalle DNI vive en personas_naturales)
-- ---------------------------------------------------------------------------
DELETE FROM public.expdedientes_extrajudicial
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN (
        '99999999','88888888','77777777','66666666','55555555',
        '44444444','33333333','22222222','10101010'
    )
);
DELETE FROM public.eventos_mora
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN (
        '99999999','88888888','77777777','66666666','55555555',
        '44444444','33333333','22222222','10101010'
    )
);
DELETE FROM public.prestamos
WHERE prestatario_id IN (
    SELECT pn.prestatario_id FROM public.personas_naturales pn
    WHERE pn.dni IN (
        '99999999','88888888','77777777','66666666','55555555',
        '44444444','33333333','22222222','10101010'
    )
);
DELETE FROM public.prestatario_incidencias
WHERE prestatario_id IN (
    SELECT pn.prestatario_id FROM public.personas_naturales pn
    WHERE pn.dni IN (
        '99999999','88888888','77777777','66666666','55555555',
        '44444444','33333333','22222222','10101010'
    )
);
DELETE FROM public.personas_naturales
WHERE dni IN (
    '99999999','88888888','77777777','66666666','55555555',
    '44444444','33333333','22222222','10101010'
);
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
        v_id, p_dni, 'Prueba', 'Hu04', 'Cupo', DATE '1990-01-01'
    );
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- S1: prestatario inexistente (CA-26)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
    v := public.evaluar_elegibilidad(gen_random_uuid(), NULL);
    PERFORM pg_temp.assert((v->>'existe')::boolean = false, 'S1: prestatario inexistente -> existe=false');
    PERFORM pg_temp.assert(v->>'motivo' = 'PRESTATARIO_INEXISTENTE', 'S1: motivo PRESTATARIO_INEXISTENTE');
    PERFORM pg_temp.assert((v->>'elegible')::boolean = false, 'S1: no elegible');
END $$;

-- ---------------------------------------------------------------------------
-- S2 (CP-11, RN-09/RN-10, RN-14): NUEVO con cupo completo 10 000
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB; v_r JSONB; v_prestamo uuid;
BEGIN
    v_p := pg_temp.crear_prestatario('99999999');

    v := public.evaluar_elegibilidad(v_p, NULL);
    PERFORM pg_temp.assert((v->>'existe')::boolean, 'S2: prestatario creado');
    PERFORM pg_temp.assert(v->>'clasificacion' = 'NUEVO', 'S2: sin historial -> NUEVO (RN-14)');
    PERFORM pg_temp.assert((v->>'ocupado')::numeric = 0, 'S2: ocupado inicial 0');
    PERFORM pg_temp.assert((v->>'disponible')::numeric = 10000.00, 'S2: disponible 10 000.00');
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S2: NUEVO sin monto -> elegible');

    v := public.evaluar_elegibilidad(v_p, 10000.00);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S2: monto exacto 10 000.00 -> elegible');

    v := public.evaluar_elegibilidad(v_p, 10000.01);
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean, 'S2: monto 10 000.01 -> no elegible');
    PERFORM pg_temp.assert(v->>'motivo' = 'CUPO_INSUFICIENTE', 'S2: motivo CUPO_INSUFICIENTE');

    v := public.evaluar_elegibilidad(v_p, 0);
    PERFORM pg_temp.assert(v->>'motivo' = 'MONTO_INVALIDO', 'S2: monto 0 -> MONTO_INVALIDO (RN-08)');

    v_r := public.reservar_cupo(v_p, 10000.00, 24,
        (SELECT id FROM public.sucursales WHERE codigo = 'TRU'), NULL, 'hu04-s2-10000');
    PERFORM pg_temp.assert((v_r->>'ok')::boolean, 'S2: reservar 10 000.00 en TRU -> ok');
    v_prestamo := (v_r->>'prestamo_id')::uuid;
    PERFORM pg_temp.assert(v_prestamo IS NOT NULL, 'S2: prestamo_id devuelto');

    -- CP-11: exposición de 10 000 deja cupo 0 y rechaza nueva solicitud.
    PERFORM pg_temp.assert(public.calcular_exposicion(v_p) = 10000.00, 'S2: exposición 10 000.00 (RN-09)');
    v := public.evaluar_elegibilidad(v_p, 1);
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean AND v->>'motivo' = 'CUPO_INSUFICIENTE',
        'S2 (CP-11): cupo 0 rechaza nueva solicitud');
END $$;

-- ---------------------------------------------------------------------------
-- S3: frontera 9 999.99 libera 0.01 de cupo (RN-10)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('88888888');
    PERFORM public.reservar_cupo(v_p, 9999.99, 12,
        (SELECT id FROM public.sucursales WHERE codigo = 'CHI'), NULL, 'hu04-s3-999999');

    v := public.evaluar_elegibilidad(v_p, 0.01);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S3: con 9 999.99 reservado, monto 0.01 -> elegible');
    v := public.evaluar_elegibilidad(v_p, 0.02);
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean AND v->>'motivo' = 'CUPO_INSUFICIENTE',
        'S3: monto 0.02 sobre disponible 0.01 -> CUPO_INSUFICIENTE');
END $$;

-- ---------------------------------------------------------------------------
-- S4: idempotencia y liberar_reserva (CA-15, CA-17, RN-31)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v_r1 JSONB; v_r2 JSONB; v_l JSONB; v_prestamo uuid; v_n int;
BEGIN
    v_p := pg_temp.crear_prestatario('77777777');

    v_r1 := public.reservar_cupo(v_p, 1000, 6,
        (SELECT id FROM public.sucursales WHERE codigo = 'CBO'), NULL, 'hu04-s4-idem');
    PERFORM pg_temp.assert((v_r1->>'ok')::boolean, 'S4: primera reserva ok');
    v_prestamo := (v_r1->>'prestamo_id')::uuid;

    v_r2 := public.reservar_cupo(v_p, 1000, 6,
        (SELECT id FROM public.sucursales WHERE codigo = 'TUM'), NULL, 'hu04-s4-idem');
    PERFORM pg_temp.assert((v_r2->>'ok')::boolean AND (v_r2->>'idempotente')::boolean,
        'S4: reenvío con misma idempotency_key -> ok idempotente');
    PERFORM pg_temp.assert((v_r2->>'prestamo_id')::uuid = v_prestamo, 'S4: devuelve el mismo prestamo_id');

    SELECT COUNT(*) INTO v_n FROM public.prestamos WHERE idempotency_key = 'hu04-s4-idem';
    PERFORM pg_temp.assert(v_n = 1, 'S4: un solo préstamo con la clave');
    PERFORM pg_temp.assert(public.calcular_exposicion(v_p) = 1000, 'S4: el reenvío no duplica exposición');

    v_l := public.liberar_reserva(v_prestamo);
    PERFORM pg_temp.assert((v_l->>'ok')::boolean AND v_l->>'estado' = 'ANULADO_SIN_DESEMBOLSO',
        'S4 (CA-17): liberar reserva -> ANULADO_SIN_DESEMBOLSO');
    PERFORM pg_temp.assert(public.calcular_exposicion(v_p) = 0, 'S4: liberación devuelve cupo a 0');

    v_r1 := public.reservar_cupo(v_p, 500, 3,
        (SELECT id FROM public.sucursales WHERE codigo = 'CBO'), NULL, 'hu04-s4-activo');
    v_prestamo := (v_r1->>'prestamo_id')::uuid;
    -- Simula desembolso (transición que hará HU-06) para probar el rechazo.
    UPDATE public.prestamos
    SET estado = 'ACTIVO', reserva_capital = 0, capital_insoluto = 500, desembolsado_en = now()
    WHERE id = v_prestamo;

    v_l := public.liberar_reserva(v_prestamo);
    PERFORM pg_temp.assert(NOT (v_l->>'ok')::boolean AND v_l->>'motivo' = 'ESTADO_NO_RESERVADO',
        'S4: liberar un ACTIVO -> ESTADO_NO_RESERVADO');

    v_l := public.liberar_reserva(gen_random_uuid());
    PERFORM pg_temp.assert(NOT (v_l->>'ok')::boolean AND v_l->>'motivo' = 'PRESTAMO_INEXISTENTE',
        'S4: préstamo inexistente -> PRESTAMO_INEXISTENTE');
END $$;

-- ---------------------------------------------------------------------------
-- S5 (RN-13, B-05): con préstamo en curso la clasificación es REGULAR
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('66666666');

    v := public.evaluar_elegibilidad(v_p, 100);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S5: primer préstamo de NUEVO -> elegible (RN-14)');
    PERFORM public.reservar_cupo(v_p, 100, 6,
        (SELECT id FROM public.sucursales WHERE codigo = 'PIU'), NULL, 'hu04-s5-100');

    v := public.evaluar_elegibilidad(v_p, NULL);
    PERFORM pg_temp.assert(v->>'clasificacion' = 'REGULAR', 'S5: con préstamo en curso -> REGULAR (B-05)');
    PERFORM pg_temp.assert((v->>'disponible')::numeric = 9900.00, 'S5: disponible 9 900.00');
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S5: REGULAR sin mora puede pedir otro (RN-13)');
END $$;

-- ---------------------------------------------------------------------------
-- S6 (CP-14, RN-15): MOROSO bloquea aunque haya cupo; cerrar racha desbloquea
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v_prestamo uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('55555555');
    INSERT INTO public.prestamos (
        prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital,
        tea, plazo_meses, estado
    ) VALUES (
        v_p, (SELECT id FROM public.sucursales WHERE codigo = 'TRU'),
        200, 200, 0, 0.30, 12, 'ACTIVO'
    ) RETURNING id INTO v_prestamo;

    INSERT INTO public.eventos_mora (prestamo_id, inicio_mora, monto_vencido)
    VALUES (v_prestamo, CURRENT_DATE - 30, 50.00);

    v := public.evaluar_elegibilidad(v_p, 1);
    PERFORM pg_temp.assert(public.calcular_exposicion(v_p) = 200, 'S6: cupo libre disponible (200 ocupados)');
    PERFORM pg_temp.assert((v->'bloqueos') @> '["MOROSO"]'::jsonb,
        'S6: bloqueos incluye MOROSO');
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean AND v->>'motivo' = 'MOROSO',
        'S6 (CP-14): MOROSO con cupo libre -> rechazado (RN-15)');

    UPDATE public.eventos_mora SET fecha_fin = CURRENT_DATE
    WHERE prestamo_id = v_prestamo AND fecha_fin IS NULL;

    v := public.evaluar_elegibilidad(v_p, 1);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S6: racha cerrada -> vuelve a ser elegible');
END $$;

-- ---------------------------------------------------------------------------
-- S7 (CP-15, RN-28): EXTRAJUDICIAL bloquea; el histórico no se borra
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v_prestamo uuid; v_evento uuid; v JSONB; v_n int;
BEGIN
    v_p := pg_temp.crear_prestatario('44444444');
    INSERT INTO public.prestamos (
        prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital,
        tea, plazo_meses, estado
    ) VALUES (
        v_p, (SELECT id FROM public.sucursales WHERE codigo = 'PIU'),
        300, 300, 0, 0.30, 24, 'ACTIVO'
    ) RETURNING id INTO v_prestamo;

    INSERT INTO public.eventos_mora (prestamo_id, inicio_mora, fecha_fin, monto_vencido)
    VALUES (v_prestamo, CURRENT_DATE - 400, CURRENT_DATE - 10, 80.00)
    RETURNING id INTO v_evento;

    INSERT INTO public.expdedientes_extrajudicial (
        prestamo_id, evento_mora_id, fecha_escalamiento, estado
    ) VALUES (v_prestamo, v_evento, CURRENT_DATE - 10, 'ABIERTO');

    v := public.evaluar_elegibilidad(v_p, 1);
    PERFORM pg_temp.assert((v->'bloqueos') @> '["EXTRAJUDICIAL"]'::jsonb,
        'S7: bloqueos incluye EXTRAJUDICIAL');
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean AND v->>'motivo' = 'EXTRAJUDICIAL',
        'S7 (CP-15): EXTRAJUDICIAL -> rechazado aunque haya cupo (RN-15)');

    UPDATE public.expdedientes_extrajudicial SET estado = 'CERRADO' WHERE prestamo_id = v_prestamo;

    v := public.evaluar_elegibilidad(v_p, 1);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S7: expediente cerrado -> sin bloqueo activo');

    SELECT COUNT(*) INTO v_n FROM public.expdedientes_extrajudicial WHERE prestamo_id = v_prestamo;
    PERFORM pg_temp.assert(v_n = 1, 'S7 (RN-28): el expediente histórico se conserva');
END $$;

-- ---------------------------------------------------------------------------
-- S8 (RN-05, CA-05): incidencia de nombre pendiente bloquea la originación
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('33333333');

    INSERT INTO public.prestatario_incidencias (
        prestatario_id, tipo, nombre_registrado, nombre_consultado, estado
    ) VALUES (v_p, 'DISCREPANCIA_NOMBRE', 'Prueba Hu04 Cupo', 'Otros Nombres', 'PENDIENTE');

    v := public.evaluar_elegibilidad(v_p, 100);
    PERFORM pg_temp.assert((v->'bloqueos') @> '["BLOQUEADO_INCIDENCIA_IDENTIDAD"]'::jsonb,
        'S8: incidencia pendiente -> bloqueo BLOQUEADO_INCIDENCIA_IDENTIDAD');
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean, 'S8: no elegible con incidencia pendiente');

    UPDATE public.prestatario_incidencias SET estado = 'RESUELTA' WHERE prestatario_id = v_p;
    v := public.evaluar_elegibilidad(v_p, 100);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S8: incidencia resuelta -> elegible');
END $$;

-- ---------------------------------------------------------------------------
-- S9: invariantes CHECK de la tabla prestamos (RN-06/07/08/10, §5)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid;
BEGIN
    -- Preactivamos un prestatario real para aislar solo los CHECK.
    v_p := (SELECT pn.prestatario_id FROM public.personas_naturales pn WHERE pn.dni = '99999999');

    BEGIN
        INSERT INTO public.prestamos (prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital, tea, plazo_meses, estado)
        VALUES (v_p, (SELECT id FROM public.sucursales WHERE codigo='TRU'), 10000.01, 0, 10000.01, 0.30, 12, 'PENDIENTE_DESEMBOLSO');
        RAISE EXCEPTION 'FALLO: principal 10 000.01 aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 principal > 10 000 rechazado';
    END;

    BEGIN
        INSERT INTO public.prestamos (prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital, tea, plazo_meses, estado)
        VALUES (v_p, (SELECT id FROM public.sucursales WHERE codigo='TRU'), 100, 0, 100, 0.30, 61, 'PENDIENTE_DESEMBOLSO');
        RAISE EXCEPTION 'FALLO: plazo 61 aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 plazo 61 rechazado (RN-07)';
    END;

    BEGIN
        INSERT INTO public.prestamos (prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital, tea, plazo_meses, estado)
        VALUES (v_p, (SELECT id FROM public.sucursales WHERE codigo='TRU'), 100, 0, 100, 0.30, 0, 'PENDIENTE_DESEMBOLSO');
        RAISE EXCEPTION 'FALLO: plazo 0 aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 plazo 0 rechazado (RN-07)';
    END;

    BEGIN
        INSERT INTO public.prestamos (prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital, tea, plazo_meses, estado)
        VALUES (v_p, (SELECT id FROM public.sucursales WHERE codigo='TRU'), 100, 0, 100, 0.25, 12, 'PENDIENTE_DESEMBOLSO');
        RAISE EXCEPTION 'FALLO: TEA 0.25 aceptada';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 TEA distinta de 0.30 rechazada (RN-06)';
    END;

    BEGIN
        INSERT INTO public.prestamos (prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital, tea, plazo_meses, estado)
        VALUES (v_p, (SELECT id FROM public.sucursales WHERE codigo='TRU'), 100, 0, 0, 0.30, 12, 'PENDIENTE_DESEMBOLSO');
        RAISE EXCEPTION 'FALLO: PENDIENTE_DESEMBOLSO sin reserva aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 importes incoherentes con estado rechazados';
    END;

    BEGIN
        INSERT INTO public.prestamos (prestatario_id, sucursal_id, principal, capital_insoluto, reserva_capital, tea, plazo_meses, estado)
        VALUES (v_p, (SELECT id FROM public.sucursales WHERE codigo='TRU'), -5, 0, 0, 0.30, 12, 'PAGADO');
        RAISE EXCEPTION 'FALLO: principal negativo aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S9 principal <= 0 rechazado (RN-08)';
    END;
END $$;

-- ---------------------------------------------------------------------------
-- S10 (RN-09/RN-32): exposición multic sede exactamente en el límite
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('22222222');

    PERFORM public.reservar_cupo(v_p, 6000, 24,
        (SELECT id FROM public.sucursales WHERE codigo = 'TRU'), NULL, 'hu04-s10-tru');
    PERFORM public.reservar_cupo(v_p, 4000, 12,
        (SELECT id FROM public.sucursales WHERE codigo = 'PIU'), NULL, 'hu04-s10-piu');

    PERFORM pg_temp.assert(public.calcular_exposicion(v_p) = 10000.00,
        'S10: 6 000 TRU + 4 000 PIU = exposición exacta 10 000 (RN-09)');

    v := public.evaluar_elegibilidad(v_p, 1);
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean AND v->>'motivo' = 'CUPO_INSUFICIENTE',
        'S10: tercera sede no puede exceder el límite global (RN-10/RN-32)');

    PERFORM pg_temp.assert(
        (SELECT COUNT(*) FROM public.prestamos WHERE prestatario_id = v_p) = 2,
        'S10: la solicitud rechazada no creó préstamo');
END $$;

-- ---------------------------------------------------------------------------
-- S11: estado auditado de la ficha (§5 BLOQUEADO auditado; columna HU-03)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_p uuid; v JSONB;
BEGIN
    v_p := pg_temp.crear_prestatario('10101010');

    UPDATE public.prestatarios SET estado = 'BLOQUEADO' WHERE id = v_p;
    v := public.evaluar_elegibilidad(v_p, 100);
    PERFORM pg_temp.assert((v->'bloqueos') @> '["BLOQUEADO_AUDITADO"]'::jsonb,
        'S11: estado BLOQUEADO auditado -> bloqueo');
    PERFORM pg_temp.assert(NOT (v->>'elegible')::boolean AND v->>'motivo' = 'BLOQUEADO_AUDITADO',
        'S11: BLOQUEADO auditado impide originar aunque haya cupo');

    UPDATE public.prestatarios SET estado = 'NUEVO' WHERE id = v_p;
    v := public.evaluar_elegibilidad(v_p, 100);
    PERFORM pg_temp.assert((v->>'elegible')::boolean, 'S11: volver a NUEVO -> elegible');
END $$;

COMMIT;

SELECT 'HU04: TODAS LAS PRUEBAS SQL PASARON' AS resultado;
