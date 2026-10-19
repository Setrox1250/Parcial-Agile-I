-- Corrección de seguridad (CA-30/RN-34): las RPC de HU-04 quedaron con
-- EXECUTE concedido a `anon` y `authenticated` porque los ALTER DEFAULT
-- PRIVILEGES de Supabase conceden EXECUTE a esos roles en todo objeto nuevo
-- del schema `public`; el REVOKE ... FROM PUBLIC de 20261018220200 no los
-- alcanza. Un cliente con solo la anon key podía invocar `reservar_cupo`,
-- `confirmar_desembolso` o `liberar_reserva` vía PostgREST (RPC), saltándose
-- la autenticación/autorización de las Edge Functions y RLS.
--
-- La HU-06 ya aplica el REVOKE explícito en su propia migración; aquí se
-- corrigen las cuatro funciones heredadas.

DO $$
DECLARE v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'calcular_exposicion(uuid)',
        'evaluar_elegibilidad(uuid,numeric)',
        'reservar_cupo(uuid,numeric,integer,uuid,uuid,text)',
        'liberar_reserva(uuid)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', v_fn);
    END LOOP;
END $$;

-- Verificación dentro de la propia migración: si alguien recupera el privilegio,
-- la migración falla en lugar de dejar el hueco abierto.
DO $$
DECLARE v_fn TEXT; v_total INT := 0;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'calcular_exposicion(uuid)',
        'evaluar_elegibilidad(uuid,numeric)',
        'reservar_cupo(uuid,numeric,integer,uuid,uuid,text)',
        'liberar_reserva(uuid)',
        'confirmar_desembolso(uuid,text,text,uuid,text)'
    ] LOOP
        EXECUTE format(
            'SELECT count(*) FROM (SELECT 1) s WHERE has_function_privilege(''anon'', ''public.%s'', ''EXECUTE'')',
            v_fn
        ) INTO v_total;
        IF v_total <> 0 THEN
            RAISE EXCEPTION 'FALLO: anon conserva EXECUTE sobre public.%', v_fn;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK: anon/authenticated sin EXECUTE sobre las RPC privilegiadas';
END $$;
