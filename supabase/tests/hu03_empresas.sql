-- HU-03 / CA-07..CA-09.
-- Ejecutar sobre una base con todas las migraciones aplicadas.

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
    RAISE NOTICE 'OK: %', p_msg;
END;
$$;

DO $$
DECLARE
    v_persona UUID;
    v_empresa UUID;
    v_eval JSONB;
    v_reserva JSONB;
    v_fallo BOOLEAN := false;
BEGIN
    -- CA-07: la RPC nunca registra una empresa que no esté ACTIVA/HABIDA.
    BEGIN
        PERFORM public.registrar_empresa(
            '20131312955', 'EMPRESA RECHAZADA QA', 'BAJA', 'NO HABIDO',
            NULL, NULL, NULL, NULL, NULL, 'PRUEBA', NULL, NULL, NULL
        );
    EXCEPTION WHEN check_violation THEN
        v_fallo := true;
    END;
    PERFORM pg_temp.assert(v_fallo, 'CA-07: RUC no activo/no habido rechazado en la RPC');

    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO')
    RETURNING id INTO v_persona;

    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    ) VALUES (
        v_persona, '12121212', 'Representante', 'Empresa', 'QA', DATE '1990-01-01'
    );

    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('EMPRESA', 'NUEVO')
    RETURNING id INTO v_empresa;

    INSERT INTO public.empresas (
        prestatario_id, ruc, razon_social, estado_ruc, condicion_ruc, fuente, consultado_en
    ) VALUES (
        v_empresa, '20131312955', 'EMPRESA QA SAC', 'ACTIVO', 'HABIDO', 'PRUEBA', now()
    );

    -- CA-08: solo RUC activo no basta; sin facultades comprobadas se bloquea.
    v_eval := public.evaluar_elegibilidad(v_empresa, 100);
    PERFORM pg_temp.assert(
        NOT (v_eval->>'elegible')::boolean
        AND (v_eval->'bloqueos') @> '["BLOQUEADO_REPRESENTACION_EMPRESA"]'::jsonb,
        'CA-08: empresa sin representación acreditada bloqueada'
    );

    INSERT INTO public.representantes_empresa (
        empresa_id, persona_id, rol, autorizacion_comprobada
    ) VALUES (v_empresa, v_persona, 'REPRESENTANTE_LEGAL', FALSE);

    v_eval := public.evaluar_elegibilidad(v_empresa, 100);
    PERFORM pg_temp.assert(
        NOT (v_eval->>'elegible')::boolean,
        'CA-08: vínculo sin evidencia no habilita originación'
    );

    PERFORM public.acreditar_representacion_empresa(
        v_empresa, '12121212', 'ACTA_QA', 'Partida QA, asiento B00001', NULL
    );
    v_eval := public.evaluar_elegibilidad(v_empresa, 100);
    PERFORM pg_temp.assert(
        (v_eval->>'elegible')::boolean,
        'CA-08: evidencia de facultades habilita la empresa'
    );

    v_reserva := public.reservar_cupo(
        v_empresa, 100, 12,
        (SELECT id FROM public.sucursales WHERE codigo = 'TRU'),
        NULL, 'hu03-qa-ruc'
    );
    PERFORM pg_temp.assert((v_reserva->>'ok')::boolean, 'CA-09: la reserva se imputa al RUC');
    PERFORM pg_temp.assert(
        public.calcular_exposicion(v_empresa) = 100
        AND public.calcular_exposicion(v_persona) = 0,
        'CA-09: deuda/cupo no se mezcla con el DNI del representante'
    );
END;
$$;

ROLLBACK;
SELECT 'HU03 empresa: CA-07..CA-09 pasaron' AS resultado;
