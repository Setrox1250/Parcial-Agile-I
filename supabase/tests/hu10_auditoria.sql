-- HU-10: controles de inmutabilidad, retención y privilegios.
-- Ejecutar sobre una base con todas las migraciones de HU10 aplicadas.
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
DECLARE v_id uuid; v_fallo boolean := false; v_bloqueo_anon boolean := false;
BEGIN
    INSERT INTO public.auditoria (accion, entidad, resultado, metadatos)
    VALUES ('SISTEMA', 'PRUEBA_HU10', 'EXITOSO', '{"origen":"prueba"}') RETURNING id INTO v_id;

    BEGIN
        UPDATE public.auditoria SET resultado = 'ERROR' WHERE id = v_id;
    EXCEPTION WHEN OTHERS THEN
        v_fallo := SQLERRM = 'AUDITORIA_INMUTABLE';
    END;
    PERFORM pg_temp.assert(v_fallo, 'CA-28: la bitácora no admite UPDATE directo');

    BEGIN
        EXECUTE 'SET LOCAL ROLE anon';
        INSERT INTO public.auditoria (accion, entidad) VALUES (''SISTEMA'', ''ATAQUE'');
    EXCEPTION WHEN OTHERS THEN
        v_bloqueo_anon := true;
    END;
    PERFORM pg_temp.assert(v_bloqueo_anon, 'CA-30: anon no escribe directamente la bitácora');
END;
$$;

DO $$
DECLARE v_antiguo uuid; v_eliminados integer;
BEGIN
    INSERT INTO public.auditoria (fecha, accion, entidad, resultado)
    VALUES (now() - interval '6 years', 'SISTEMA', 'RETENCION_HU10', 'EXITOSO') RETURNING id INTO v_antiguo;
    v_eliminados := public.depurar_auditoria(interval '5 years');
    PERFORM pg_temp.assert(v_eliminados >= 1 AND NOT EXISTS (
        SELECT 1 FROM public.auditoria WHERE id = v_antiguo
    ), 'CA-30: la retención elimina solo evidencia expirada mediante función privilegiada');
    PERFORM pg_temp.assert(
        NOT has_function_privilege('anon', 'public.depurar_auditoria(interval)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.depurar_auditoria(interval)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.depurar_auditoria(interval)', 'EXECUTE'),
        'CA-30: la purga solo está disponible para service_role'
    );
END;
$$;

ROLLBACK;
SELECT 'HU10: TODAS LAS PRUEBAS SQL PASARON' AS resultado;
