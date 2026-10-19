-- HU-03 / CA-08: una empresa no puede originar crédito sin representante con
-- DNI validado (HU-02) y facultades comprobadas. Ejecutar sobre la base local:
--
-- docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
--   -v ON_ERROR_STOP=1 -f - < supabase/tests/hu03_representacion.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NULL OR NOT p_cond THEN
        RAISE EXCEPTION 'FALLO: %', p_msg;
    END IF;
    RAISE NOTICE 'OK: %', p_msg;
END;
$$;

DO $$
DECLARE
    v_persona UUID;
    v_empresa UUID;
    v_eval JSONB;
    v_reserva JSONB;
BEGIN
    -- Persona natural ya validada por HU-02.
    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO')
    RETURNING id INTO v_persona;

    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    ) VALUES (
        v_persona, '12121212', 'Prueba', 'Representante', 'Empresa', DATE '1990-01-01'
    );

    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('EMPRESA', 'NUEVO')
    RETURNING id INTO v_empresa;

    INSERT INTO public.empresas (
        prestatario_id, ruc, razon_social, estado_ruc, condicion_ruc, fuente, consultado_en
    ) VALUES (
        v_empresa, '20123456789', 'EMPRESA QA SAC', 'ACTIVO', 'HABIDO', 'PRUEBA', now()
    );

    v_eval := public.evaluar_elegibilidad(v_empresa, 100);
    PERFORM pg_temp.assert(
        NOT (v_eval->>'elegible')::boolean
        AND v_eval->>'motivo' = 'BLOQUEADO_REPRESENTACION_EMPRESA',
        'sin representante comprobado, la empresa no es elegible (CA-08)'
    );

    -- Vincular un DNI sin evidencia de facultades sigue sin ser suficiente.
    INSERT INTO public.representantes_empresa (
        empresa_id, persona_id, rol, autorizacion_comprobada
    ) VALUES (
        v_empresa, v_persona, 'REPRESENTANTE_LEGAL', FALSE
    );

    v_eval := public.evaluar_elegibilidad(v_empresa, 100);
    PERFORM pg_temp.assert(
        NOT (v_eval->>'elegible')::boolean
        AND (v_eval->'bloqueos') @> '["BLOQUEADO_REPRESENTACION_EMPRESA"]'::jsonb,
        'un representante solo vinculado no habilita originación'
    );

    v_reserva := public.acreditar_representacion_empresa(
        v_empresa, '12121212', 'ACTA_VERIFICADA_QA', 'Partida QA, asiento B00001', NULL
    );
    PERFORM pg_temp.assert(
        (v_reserva->>'ok')::boolean AND NOT (v_reserva->>'idempotente')::boolean,
        'la acreditación registra evidencia y habilita al representante'
    );

    v_eval := public.evaluar_elegibilidad(v_empresa, 100);
    PERFORM pg_temp.assert(
        (v_eval->>'elegible')::boolean,
        'representante DNI validado y facultades comprobadas habilita la empresa'
    );

    v_reserva := public.reservar_cupo(
        v_empresa, 100, 12,
        (SELECT id FROM public.sucursales WHERE codigo = 'TRU'),
        NULL, 'hu03-representacion-qa'
    );
    PERFORM pg_temp.assert(
        (v_reserva->>'ok')::boolean,
        'la reserva solo es posible después de comprobar la representación'
    );
END;
$$;

ROLLBACK;

SELECT 'HU03 representación: TODAS LAS PRUEBAS SQL PASARON' AS resultado;
