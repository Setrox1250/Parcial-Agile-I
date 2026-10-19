-- HU-02 / 2.1.4: lectura de identidad para usuarios operativos.
--
-- Las altas y cambios siguen restringidos a las Edge Functions (service_role).
-- La política de lectura no usa el rol enviado por el cliente: consulta el
-- perfil autenticado almacenado en `perfiles` y exige que esté activo.

CREATE OR REPLACE FUNCTION public.usuario_puede_leer_identidad()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE auth_user_id = auth.uid()
          AND activo = TRUE
          AND rol IN ('ADMIN', 'SUPERVISOR_FINANCIERO')
    );
$$;

REVOKE ALL ON FUNCTION public.usuario_puede_leer_identidad() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_puede_leer_identidad() TO authenticated;

DROP POLICY IF EXISTS prestatarios_select_identidad ON public.prestatarios;
CREATE POLICY prestatarios_select_identidad
    ON public.prestatarios
    FOR SELECT
    TO authenticated
    USING (public.usuario_puede_leer_identidad());

DROP POLICY IF EXISTS personas_naturales_select_identidad ON public.personas_naturales;
CREATE POLICY personas_naturales_select_identidad
    ON public.personas_naturales
    FOR SELECT
    TO authenticated
    USING (public.usuario_puede_leer_identidad());

DROP POLICY IF EXISTS empresas_select_identidad ON public.empresas;
CREATE POLICY empresas_select_identidad
    ON public.empresas
    FOR SELECT
    TO authenticated
    USING (public.usuario_puede_leer_identidad());

DROP POLICY IF EXISTS representantes_empresa_select_identidad ON public.representantes_empresa;
CREATE POLICY representantes_empresa_select_identidad
    ON public.representantes_empresa
    FOR SELECT
    TO authenticated
    USING (public.usuario_puede_leer_identidad());

COMMENT ON FUNCTION public.usuario_puede_leer_identidad() IS
    'HU-02/2.1.4: lectura directa de identidad solo para perfiles ADMIN o SUPERVISOR_FINANCIERO activos.';
