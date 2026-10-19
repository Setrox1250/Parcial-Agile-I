-- HU-02 / CA-04..CA-06 y 2.1.4.
-- Ejecutar sobre una base con las migraciones aplicadas.
-- El bloque de RLS se verifica con roles de aplicación; las pruebas de
-- proveedor se cubren en supabase/functions/dni-lookup/validar.test.js.

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert(p_cond boolean, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
    RAISE NOTICE 'OK: %', p_msg;
END;
$$;

SELECT pg_temp.assert(
    EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'personas_naturales'
          AND policyname = 'personas_naturales_select_identidad'
          AND cmd = 'SELECT'
    ),
    '2.1.4: personas_naturales tiene política SELECT explícita'
);

SELECT pg_temp.assert(
    has_function_privilege(
        'authenticated',
        'public.usuario_puede_leer_identidad()',
        'EXECUTE'
    ),
    '2.1.4: authenticated puede evaluar la política de lectura'
);

SELECT pg_temp.assert(
    NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'personas_naturales'
          AND cmd = 'SELECT'
          AND 'anon' = ANY (roles)
    ),
    '2.1.4: anon no tiene política de lectura de identidad'
);

SELECT pg_temp.assert(
    NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'personas_naturales'
          AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ),
    '2.1.4: no existen políticas de escritura para personas_naturales'
);

ROLLBACK;
SELECT 'HU02 identidad: controles RLS pasaron' AS resultado;
