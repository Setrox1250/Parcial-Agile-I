
-- 0.5.2: Tabla de perfiles de usuario
-- Roles: ADMIN (global, sucursal opcional) y SUPERVISOR_FINANCIERO (con sucursal propia).
-- El SUPERVISOR_FINANCIERO ejerce también las operaciones de caja (desembolso y cobranza).

CREATE TABLE public.perfiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    auth_user_id UUID NOT NULL UNIQUE
        REFERENCES auth.users(id) ON DELETE CASCADE,

    nombre_visible TEXT NOT NULL,

    rol TEXT NOT NULL,

    sucursal_id UUID
        REFERENCES public.sucursales(id) ON DELETE RESTRICT,

    activo BOOLEAN NOT NULL DEFAULT true,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT perfiles_nombre_no_vacio
        CHECK (length(trim(nombre_visible)) > 0),

    CONSTRAINT perfiles_rol_valido
        CHECK (
            rol IN (
                'ADMIN',
                'SUPERVISOR_FINANCIERO'
            )
        ),

    -- Solo el ADMIN es global (sucursal opcional); el resto opera en su sede.
    CONSTRAINT perfiles_sucursal_requerida
        CHECK (rol = 'ADMIN' OR sucursal_id IS NOT NULL)
);

COMMENT ON TABLE public.perfiles IS
    'Perfil de cada usuario autenticado, con rol y sucursal asignada';

CREATE INDEX idx_perfiles_sucursal
    ON public.perfiles (sucursal_id);

CREATE INDEX idx_perfiles_rol_activo
    ON public.perfiles (rol, activo);
