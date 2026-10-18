-- HU-02: Identidad de prestatarios naturales (persona natural peruana con DNI)
-- RN-01: DNI peruano de 8 dígitos, único en toda la empresa.
-- RN-02: nombres y apellidos provienen del proveedor (Scrall), no del empleado.
-- RN-05: discrepancia de nombre => incidencia de corrección con auditoría (tabla abajo).
-- B-01: Scrall Básico no entrega caducidad; no se afirma vigencia (dni_vigente NULL).

CREATE TABLE public.prestatarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tipo_documento TEXT NOT NULL DEFAULT 'DNI',

    numero_documento TEXT NOT NULL,

    nombres TEXT NOT NULL,
    apellido_paterno TEXT NOT NULL,
    apellido_materno TEXT NOT NULL,

    fecha_nacimiento DATE NOT NULL,

    -- B-01: solo podrá ser true con evidencia de fuente verificable autorizada.
    dni_vigente BOOLEAN,

    creado_por UUID
        REFERENCES auth.users(id) ON DELETE SET NULL,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT prestatarios_tipo_documento_dni
        CHECK (tipo_documento = 'DNI'),

    CONSTRAINT prestatarios_documento_dni_8_digitos
        CHECK (numero_documento ~ '^[0-9]{8}$'),

    CONSTRAINT prestatarios_nombres_no_vacios
        CHECK (
            length(trim(nombres)) > 0
            AND length(trim(apellido_paterno)) > 0
            AND length(trim(apellido_materno)) > 0
        ),

    CONSTRAINT prestatarios_fecha_nacimiento_coherente
        CHECK (fecha_nacimiento <= CURRENT_DATE),

    CONSTRAINT prestatarios_vigencia_sin_evidencia
        CHECK (dni_vigente IS NOT TRUE),

    -- Ficha global única por documento (RAíz de CA-05: un DNI => una ficha).
    CONSTRAINT prestatarios_documento_unico
        UNIQUE (tipo_documento, numero_documento)
);

COMMENT ON TABLE public.prestatarios IS
    'Ficha global de prestatario por documento. Nombres solo desde proveedor de identidad; sin edición ordinaria desde el cliente (RLS sin policies).';
COMMENT ON COLUMN public.prestatarios.tipo_documento IS
    'Solo DNI por ahora; HU-03 ampliará a RUC con sus propias validaciones.';
COMMENT ON COLUMN public.prestatarios.dni_vigente IS
    'B-01: NULL mientras no exista fuente verificable de caducidad. Scrall Básico no entrega vigencia.';
COMMENT ON COLUMN public.prestatarios.creado_por IS
    'Usuario autenticado que originó la ficha (auditoría HU-10/CA-28).';

-- ---------------------------------------------------------------------------
-- Incidencias de corrección (RN-05): discrepancia de nombre detectada en
-- consulta. La originación queda bloqueada hasta corrección autorizada;
-- el histórico no se borra (CA-27).
-- ---------------------------------------------------------------------------
CREATE TABLE public.prestatario_incidencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prestatario_id UUID NOT NULL
        REFERENCES public.prestatarios(id) ON DELETE RESTRICT,

    tipo TEXT NOT NULL,

    nombre_registrado TEXT NOT NULL,
    nombre_consultado TEXT NOT NULL,

    estado TEXT NOT NULL DEFAULT 'PENDIENTE',

    detectado_por UUID
        REFERENCES auth.users(id) ON DELETE SET NULL,
    detectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT incidencia_tipo_valido
        CHECK (tipo IN ('DISCREPANCIA_NOMBRE')),

    CONSTRAINT incidencia_estado_valido
        CHECK (estado IN ('PENDIENTE', 'RESUELTA')),

    CONSTRAINT incidencia_nombres_no_vacios
        CHECK (
            length(trim(nombre_registrado)) > 0
            AND length(trim(nombre_consultado)) > 0
        ),

    -- Solo se registra cuando los nombres realmente difieren.
    CONSTRAINT incidencia_nombres_distintos
        CHECK (nombre_registrado <> nombre_consultado)
);

COMMENT ON TABLE public.prestatario_incidencias IS
    'Historial de discrepancias nombre registrado vs consultado (RN-05). Append-only; no se elimina historial.';

CREATE INDEX idx_prestatario_incidencias_prestatario
    ON public.prestatario_incidencias (prestatario_id);

CREATE INDEX idx_prestatario_incidencias_pendientes
    ON public.prestatario_incidencias (estado)
    WHERE estado = 'PENDIENTE';

-- ---------------------------------------------------------------------------
-- RLS: acceso denegado al cliente (anon/authenticated). Toda lectura y
-- escritura ocurre en Edge Functions con service_role (bypasea RLS),
-- igual que la convención de 0.6.1/0.6.2.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prestatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prestatario_incidencias ENABLE ROW LEVEL SECURITY;
