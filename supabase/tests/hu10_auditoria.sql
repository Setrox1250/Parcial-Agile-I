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
        INSERT INTO public.auditoria (accion, entidad) VALUES ('SISTEMA', 'ATAQUE');
    EXCEPTION WHEN OTHERS THEN
        v_bloqueo_anon := true;
    END;
    PERFORM pg_temp.assert(v_bloqueo_anon, 'CA-30: anon no escribe directamente la bitácora');
END;
$$;

DO $$
DECLARE
    v_actor UUID;
    v_sucursal UUID;
    v_prestatario UUID;
    v_prestamo UUID;
    v_pago UUID;
BEGIN
    SELECT auth_user_id, sucursal_id
      INTO v_actor, v_sucursal
      FROM public.perfiles
     WHERE activo = TRUE
     ORDER BY creado_en
     LIMIT 1;
    INSERT INTO public.prestatarios (tipo, estado, creado_por)
    VALUES ('PERSONA_NATURAL', 'NUEVO', v_actor)
    RETURNING id INTO v_prestatario;

    INSERT INTO public.prestamos (
        prestatario_id, sucursal_id, creado_por, principal,
        capital_insoluto, reserva_capital, plazo_meses, estado, idempotency_key
    ) VALUES (
        v_prestatario, v_sucursal, v_actor, 100,
        0, 100, 12, 'PENDIENTE_DESEMBOLSO', 'hu10-auditoria-prestamo'
    ) RETURNING id INTO v_prestamo;

    PERFORM pg_temp.assert(
        EXISTS (
            SELECT 1 FROM public.auditoria
             WHERE entidad = 'prestamos'
               AND entidad_id = v_prestamo
               AND actor = v_actor
               AND sucursal_id = v_sucursal
               AND correlacion = 'hu10-auditoria-prestamo'
        ),
        'CA-28: originación conserva actor, sede e idempotencia'
    );

    INSERT INTO public.pagos (
        prestamo_id, monto, medio, estado, registra, confirma, confirmado_en,
        idempotency_key
    ) VALUES (
        v_prestamo, 10, 'EFECTIVO', 'CONFIRMADO', v_actor, v_actor, now(),
        'hu10-auditoria-pago'
    ) RETURNING id INTO v_pago;

    PERFORM pg_temp.assert(
        EXISTS (
            SELECT 1 FROM public.auditoria
             WHERE entidad = 'pagos'
               AND entidad_id = v_pago
               AND actor = v_actor
               AND sucursal_id = v_sucursal
               AND correlacion = 'hu10-auditoria-pago'
        ),
        'CA-28: cobro conserva actor, sede e idempotencia'
    );
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
