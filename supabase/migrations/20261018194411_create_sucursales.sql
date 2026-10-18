
-- 0.5.1: Tabla base de sucursales

CREATE TABLE public.sucursales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    direccion TEXT,
    estado TEXT NOT NULL DEFAULT 'ACTIVA',

    CONSTRAINT sucursales_codigo_no_vacio
        CHECK (length(trim(codigo)) > 0),

    CONSTRAINT sucursales_nombre_no_vacio
        CHECK (length(trim(nombre)) > 0),

    CONSTRAINT sucursales_estado_valido
        CHECK (estado IN ('ACTIVA', 'INACTIVA'))
);

COMMENT ON TABLE public.sucursales IS
    'Catálogo de sucursales del sistema de préstamos multisucursal';

CREATE INDEX idx_sucursales_estado
    ON public.sucursales (estado);
