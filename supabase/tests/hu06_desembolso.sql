-- HU-06: pruebas de confirmación de desembolso y anulación previa
-- (CA-16, CA-17, RN-09/RN-30/RN-31). Ejecutar con el stack local arriba:
--   docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/hu06_desembolso.sql

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Limpieza re-ejecutable de los DNIs de prueba de esta suite
-- ---------------------------------------------------------------------------
DELETE FROM public.desembolsos
WHERE prestamo_id IN (
    SELECT p.id FROM public.prestamos p
    JOIN public.personas_naturales pn ON pn.prestatario_id = p.prestatario_id
    WHERE pn.dni IN ('51515151','52525252','53535353','54545454','56565656','57575757')
);
DELETE FROM public.prestamos
WHERE prestatario_id IN (
    SELECT pn.prestatario_id FROM public.personas_naturales pn
    WHERE pn.dni IN ('51515151','52525252','53535353','54545454','56565656','57575757')
);
DELETE FROM public.personas_naturales
WHERE dni IN ('51515151','52525252','53535353','54545454','56565656','57575757');
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
        v_id, p_dni, 'Desembolso', 'Hu06', 'Prueba', DATE '1990-01-01'
    );
    RETURN v_id;
END;
$$;

-- Crea un préstamo reservado (PENDIENTE_DESEMBOLSO) en la sucursal indicada.
CREATE FUNCTION pg_temp.reservar(p_dni text, p_monto numeric, p_sucursal text,
                                 p_clave text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_r JSONB; v_p uuid;
BEGIN
    v_p := pg_temp.crear_prestatario(p_dni);
    v_r := public.reservar_cupo(v_p, p_monto, 12,
        (SELECT id FROM public.sucursales WHERE codigo = p_sucursal), NULL, p_clave);
    IF NOT (v_r->>'ok')::boolean THEN
        RAISE EXCEPTION 'FALLO: la reserva de prueba falló (%)', v_r->>'motivo';
    END IF;
    RETURN (v_r->>'prestamo_id')::uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- S1 (CA-16): confirmación en efectivo activa el préstamo y deja evidencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_prestamo uuid; v JSONB; v_estado text; v_insoluto numeric;
        v_reserva numeric; v_desembolsos int; v_metodo text; v_ref text;
BEGIN
    v_prestamo := pg_temp.reservar('51515151', 1500, 'TRU', 'hu06-s1');

    v := public.confirmar_desembolso(v_prestamo, 'EFECTIVO', NULL, NULL, 'hu06-s1-clave');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S1: confirmación en efectivo -> ok');
    PERFORM pg_temp.assert((v->>'idempotente')::boolean = false, 'S1: primera confirmación no es idempotente');
    PERFORM pg_temp.assert(v->>'estado' = 'ACTIVO', 'S1: préstamo pasa a ACTIVO (CA-16)');
    PERFORM pg_temp.assert((v->>'importe')::numeric = 1500, 'S1: importe = principal contratado');

    SELECT estado, capital_insoluto, reserva_capital
    INTO v_estado, v_insoluto, v_reserva
    FROM public.prestamos WHERE id = v_prestamo;
    PERFORM pg_temp.assert(v_estado = 'ACTIVO', 'S1: estado persistido ACTIVO');
    PERFORM pg_temp.assert(v_insoluto = 1500 AND v_reserva = 0,
        'S1: reserva pasa a capital insoluto (RN-09)');
    PERFORM pg_temp.assert(
        (SELECT desembolsado_en IS NOT NULL FROM public.prestamos WHERE id = v_prestamo),
        'S1: fecha de desembolso registrada');

    SELECT COUNT(*), MAX(metodo), MAX(referencia)
    INTO v_desembolsos, v_metodo, v_ref
    FROM public.desembolsos WHERE prestamo_id = v_prestamo;
    PERFORM pg_temp.assert(v_desembolsos = 1, 'S1: una sola evidencia de desembolso (CA-16)');
    PERFORM pg_temp.assert(v_metodo = 'EFECTIVO' AND v_ref IS NULL,
        'S1: método EFECTIVO sin referencia');

    -- La exposición sigue contada (el desembolso no libera cupo).
    PERFORM pg_temp.assert(public.calcular_exposicion(
        (SELECT prestatario_id FROM public.prestamos WHERE id = v_prestamo)) = 1500,
        'S1: desembolsar mantiene la exposición en 1500 (RN-09)');
END $$;

-- ---------------------------------------------------------------------------
-- S2 (CA-17): doble confirmación rechazada, sin segunda evidencia
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_prestamo uuid; v JSONB; v_n int;
BEGIN
    v_prestamo := pg_temp.reservar('52525252', 800, 'CHI', 'hu06-s2');
    v := public.confirmar_desembolso(v_prestamo, 'EFECTIVO', NULL, NULL, 'hu06-s2-a');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S2: primera confirmación ok');

    v := public.confirmar_desembolso(v_prestamo, 'EFECTIVO', NULL, NULL, 'hu06-s2-b');
    PERFORM pg_temp.assert((v->>'ok')::boolean = false, 'S2: segunda confirmación rechazada (CA-17)');
    PERFORM pg_temp.assert(v->>'motivo' = 'DESEMBOLLO_YA_CONFIRMADO',
        'S2: motivo DESEMBOLLO_YA_CONFIRMADO');

    v_n := (SELECT COUNT(*) FROM public.desembolsos WHERE prestamo_id = v_prestamo);
    PERFORM pg_temp.assert(v_n = 1, 'S2: sigue habiendo una sola evidencia');
END $$;

-- ---------------------------------------------------------------------------
-- S3 (RN-31): misma idempotency_key devuelve el desembolso existente
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_prestamo uuid; v JSONB; v_n int;
BEGIN
    v_prestamo := pg_temp.reservar('53535353', 500, 'PIU', 'hu06-s3');
    v := public.confirmar_desembolso(v_prestamo, 'TRANSFERENCIA', 'CCI-0001', NULL, 'hu06-s3-idem');
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S3: transferencia con referencia -> ok');

    v := public.confirmar_desembolso(v_prestamo, 'TRANSFERENCIA', 'CCI-0001', NULL, 'hu06-s3-idem');
    PERFORM pg_temp.assert((v->>'ok')::boolean AND (v->>'idempotente')::boolean,
        'S3: reintento con la misma clave -> idempotente (RN-31)');

    v_n := (SELECT COUNT(*) FROM public.desembolsos WHERE prestamo_id = v_prestamo);
    PERFORM pg_temp.assert(v_n = 1, 'S3: la clave idempotente no duplica evidencias');
END $$;

-- ---------------------------------------------------------------------------
-- S4: validación de método y referencia (CA-16)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_prestamo uuid; v JSONB;
BEGIN
    v_prestamo := pg_temp.reservar('54545454', 300, 'TUM', 'hu06-s4');

    v := public.confirmar_desembolso(v_prestamo, 'TRANSFERENCIA', NULL, NULL, NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean = false AND v->>'motivo' = 'REFERENCIA_REQUERIDA',
        'S4: transferencia sin referencia -> REFERENCIA_REQUERIDA');

    v := public.confirmar_desembolso(v_prestamo, 'CHEQUE', NULL, NULL, NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean = false AND v->>'motivo' = 'METODO_INVALIDO',
        'S4: método desconocido -> METODO_INVALIDO');

    v := public.confirmar_desembolso(v_prestamo, 'EFECTIVO', 'NO-DEBE-QUEDAR', NULL, NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S4: efectivo con referencia -> ok');
    PERFORM pg_temp.assert(
        (SELECT referencia IS NULL FROM public.desembolsos WHERE prestamo_id = v_prestamo),
        'S4: en efectivo la referencia queda NULL');
END $$;

-- ---------------------------------------------------------------------------
-- S5 (CA-17): anulación previa libera la reserva y bloquea la confirmación
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_prestamo uuid; v JSONB; v_estado text; v_expo numeric; v_n int;
BEGIN
    v_prestamo := pg_temp.reservar('56565656', 700, 'TRU', 'hu06-s5');

    v := public.liberar_reserva(v_prestamo);
    PERFORM pg_temp.assert((v->>'ok')::boolean, 'S5: anulación antes del desembolso -> ok');

    SELECT estado INTO v_estado FROM public.prestamos WHERE id = v_prestamo;
    PERFORM pg_temp.assert(v_estado = 'ANULADO_SIN_DESEMBOLSO', 'S5: estado ANULADO_SIN_DESEMBOLSO (CA-17)');

    v_expo := public.calcular_exposicion(
        (SELECT prestatario_id FROM public.prestamos WHERE id = v_prestamo));
    PERFORM pg_temp.assert(v_expo = 0, 'S5: la anulación libera el cupo reservado (CA-17)');

    v := public.confirmar_desembolso(v_prestamo, 'EFECTIVO', NULL, NULL, NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean = false AND v->>'motivo' = 'ESTADO_NO_DESEMBOLLABLE',
        'S5: no se puede desembolsar un préstamo anulado');

    v_n := (SELECT COUNT(*) FROM public.desembolsos WHERE prestamo_id = v_prestamo);
    PERFORM pg_temp.assert(v_n = 0, 'S5: la anulación no deja evidencia de desembolso');
END $$;

-- ---------------------------------------------------------------------------
-- S6: préstamo inexistente y restricciones de la tabla de evidencias
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_prestamo uuid; v JSONB;
BEGIN
    v := public.confirmar_desembolso(gen_random_uuid(), 'EFECTIVO', NULL, NULL, NULL);
    PERFORM pg_temp.assert((v->>'ok')::boolean = false AND v->>'motivo' = 'PRESTAMO_INEXISTENTE',
        'S6: préstamo inexistente -> PRESTAMO_INEXISTENTE');

    v_prestamo := pg_temp.reservar('57575757', 250, 'CHI', 'hu06-s6');

    BEGIN
        INSERT INTO public.desembolsos (prestamo_id, importe, metodo, referencia, sucursal_id)
        VALUES (v_prestamo, 250, 'EFECTIVO', 'CON-REF',
                (SELECT id FROM public.sucursales WHERE codigo = 'CHI'));
        RAISE EXCEPTION 'FALLO: referencia en efectivo aceptada';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S6 evidencia de EFECTIVO con referencia rechazada';
    END;

    BEGIN
        INSERT INTO public.desembolsos (prestamo_id, importe, metodo, referencia, sucursal_id)
        VALUES (v_prestamo, 0, 'EFECTIVO', NULL,
                (SELECT id FROM public.sucursales WHERE codigo = 'CHI'));
        RAISE EXCEPTION 'FALLO: importe 0 aceptado';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK: S6 importe <= 0 rechazado';
    END;
END $$;

-- ---------------------------------------------------------------------------
-- S7 (RN-30/CA-30): privilegios y RLS de la evidencia
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    PERFORM pg_temp.assert(
        NOT has_function_privilege('anon', 'public.confirmar_desembolso(uuid,text,text,uuid,text)', 'EXECUTE'),
        'S7: anon no puede ejecutar confirmar_desembolso');
    PERFORM pg_temp.assert(
        NOT has_function_privilege('authenticated', 'public.confirmar_desembolso(uuid,text,text,uuid,text)', 'EXECUTE'),
        'S7: authenticated no puede ejecutar confirmar_desembolso');
    PERFORM pg_temp.assert(
        has_function_privilege('service_role', 'public.confirmar_desembolso(uuid,text,text,uuid,text)', 'EXECUTE'),
        'S7: service_role sí puede ejecutar confirmar_desembolso');
    PERFORM pg_temp.assert(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.desembolsos'::regclass),
        'S7: RLS habilitado en desembolsos (CA-30)');
END $$;

COMMIT;

SELECT 'HU06: TODAS LAS PRUEBAS SQL PASARON' AS resultado;
