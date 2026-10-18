
-- 0.6.1 / 0.6.2: RLS base
-- Los usuarios autenticados solo LEE; ninguna escritura directa desde el cliente.
-- Toda escritura pasa por Edge Functions con service role (bypasea RLS).

-- ---------------------------------------------------------------------------
-- sucursales: catálogo no sensible, legible para cualquier usuario autenticado
-- ---------------------------------------------------------------------------
ALTER TABLE public.sucursales ENABLE ROW LEVEL SECURITY;

CREATE POLICY sucursales_select_authenticated
    ON public.sucursales
    FOR SELECT
    TO authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- perfiles: cada usuario ve únicamente su propio perfil.
-- La consulta de perfiles ajenos (gestión de usuarios ADMIN) se hace desde
-- Edge Functions con service role.
-- ---------------------------------------------------------------------------
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY perfiles_select_propia
    ON public.perfiles
    FOR SELECT
    TO authenticated
    USING (auth_user_id = auth.uid());

-- Sin policies de INSERT/UPDATE/DELETE: por defecto denegado para
-- anon y authenticated.
