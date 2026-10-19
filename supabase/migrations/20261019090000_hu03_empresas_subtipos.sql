-- HU-03: identidad de empresa peruana (RUC) sobre el modelo de prestatario.
--
-- Modelo (spec §5, opción B): `prestatarios` es la identidad común del deudor
-- (`id`, `tipo`, `estado`); el detalle vive en `personas_naturales` (HU-02) y
-- `empresas` (HU-03). El vínculo entre la empresa y la persona que la representa
-- o es su titular va en `representantes_empresa`.
--
-- Se arrastran pendientes de HU-02:
--   * 2.1.2 — subtipos separados (`personas_naturales`).
--   * 2.2.1 / 2.3.6 — `validaciones_identidad` (traza §5, sin payload íntegro).
--   * 2.4.4 — altas transaccionales vía funciones RPC (sin fichas huérfanas).
--
-- Reglas: CA-07 (RUC ACTIVO + HABIDO), CA-08/B-07 (representante sin poderes
-- comprobados NO origina), CA-09/RN-36 (el cupo es por prestatario, DNI o RUC).

-- ---------------------------------------------------------------------------
-- 1) Subtipo persona natural (detalle de un prestatario PERSONA_NATURAL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personas_naturales (
    prestatario_id UUID PRIMARY KEY
        REFERENCES public.prestatarios(id) ON DELETE RESTRICT,

    dni CHAR(8) NOT NULL,

    nombres TEXT NOT NULL,
    apellido_paterno TEXT NOT NULL,
    apellido_materno TEXT NOT NULL,

    fecha_nacimiento DATE NOT NULL,

    -- B-01: solo true con evidencia de fuente verificable autorizada.
    dni_vigente BOOLEAN,

    -- Última vez que se validó contra el proveedor de identidad (Scrall).
    fecha_validacion TIMESTAMPTZ,

    CONSTRAINT personas_naturales_dni_8_digitos
        CHECK (dni ~ '^[0-9]{8}$'),
    CONSTRAINT personas_naturales_dni_unico
        UNIQUE (dni),
    CONSTRAINT personas_naturales_nombres_no_vacios
        CHECK (
            length(trim(nombres)) > 0
            AND length(trim(apellido_paterno)) > 0
            AND length(trim(apellido_materno)) > 0
        ),
    CONSTRAINT personas_naturales_fecha_nacimiento_coherente
        CHECK (fecha_nacimiento <= CURRENT_DATE),
    CONSTRAINT personas_naturales_vigencia_sin_evidencia
        CHECK (dni_vigente IS NOT TRUE)
);

-- ---------------------------------------------------------------------------
-- 2) Migrar los datos que hoy viven en `prestatarios` (HU-02) al subtipo.
--    Idempotente: solo actúa si las columnas antiguas aún existen.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'prestatarios'
          AND column_name = 'numero_documento'
    ) THEN
        INSERT INTO public.personas_naturales (
            prestatario_id, dni, nombres, apellido_paterno, apellido_materno,
            fecha_nacimiento, dni_vigente, fecha_validacion
        )
        SELECT id, numero_documento, nombres, apellido_paterno, apellido_materno,
               fecha_nacimiento, dni_vigente, creado_en
        FROM public.prestatarios
        WHERE tipo_documento = 'DNI'
        ON CONFLICT (prestatario_id) DO NOTHING;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Adelgazar `prestatarios` a (id, tipo, estado).
--    `tipo`     — identidad del deudor: persona natural o empresa.
--    `estado`   — elegibilidad (HU-04). Se declara aquí por §5 y con
--                 IF NOT EXISTS para no chocar con la migración de HU-04.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prestatarios ADD COLUMN IF NOT EXISTS tipo TEXT;
UPDATE public.prestatarios SET tipo = 'PERSONA_NATURAL' WHERE tipo IS NULL;
ALTER TABLE public.prestatarios ALTER COLUMN tipo SET DEFAULT 'PERSONA_NATURAL';
ALTER TABLE public.prestatarios ALTER COLUMN tipo SET NOT NULL;

ALTER TABLE public.prestatarios
    ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'NUEVO';

DO $$
BEGIN
    ALTER TABLE public.prestatarios
        ADD CONSTRAINT prestatarios_tipo_valido
        CHECK (tipo IN ('PERSONA_NATURAL', 'EMPRESA'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.prestatarios
        ADD CONSTRAINT prestatarios_estado_valido
        CHECK (estado IN ('NUEVO', 'REGULAR', 'MOROSO', 'BLOQUEADO', 'INACTIVO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Quitar columnas y restricciones que ahora pertenecen al subtipo.
ALTER TABLE public.prestatarios
    DROP CONSTRAINT IF EXISTS prestatarios_tipo_documento_dni,
    DROP CONSTRAINT IF EXISTS prestatarios_documento_dni_8_digitos,
    DROP CONSTRAINT IF EXISTS prestatarios_nombres_no_vacios,
    DROP CONSTRAINT IF EXISTS prestatarios_fecha_nacimiento_coherente,
    DROP CONSTRAINT IF EXISTS prestatarios_vigencia_sin_evidencia,
    DROP CONSTRAINT IF EXISTS prestatarios_documento_unico,
    DROP COLUMN IF EXISTS tipo_documento,
    DROP COLUMN IF EXISTS numero_documento,
    DROP COLUMN IF EXISTS nombres,
    DROP COLUMN IF EXISTS apellido_paterno,
    DROP COLUMN IF EXISTS apellido_materno,
    DROP COLUMN IF EXISTS fecha_nacimiento,
    DROP COLUMN IF EXISTS dni_vigente;

COMMENT ON TABLE public.prestatarios IS
    'Identidad común del deudor (persona natural o empresa). El detalle vive en personas_naturales / empresas.';
COMMENT ON COLUMN public.prestatarios.tipo IS
    'PERSONA_NATURAL | EMPRESA. Determina qué subtipo cuelga de la ficha.';
COMMENT ON COLUMN public.prestatarios.estado IS
    'Elegibilidad del deudor (HU-04). NUEVO por defecto al dar de alta la identidad.';

COMMENT ON TABLE public.personas_naturales IS
    'Detalle de un prestatario persona natural. Nombres solo desde el proveedor de identidad.';

-- ---------------------------------------------------------------------------
-- 4) Subtipo empresa (detalle de un prestatario EMPRESA).
--    CA-07: razón social, estado y condición se cotejan con la fuente y fecha.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.empresas (
    prestatario_id UUID PRIMARY KEY
        REFERENCES public.prestatarios(id) ON DELETE RESTRICT,

    ruc CHAR(11) NOT NULL,

    razon_social TEXT NOT NULL,

    -- Cotejados contra la fuente SUNAT/agregador (CA-07).
    estado_ruc TEXT,
    condicion_ruc TEXT,

    direccion TEXT,
    departamento TEXT,
    provincia TEXT,
    distrito TEXT,
    ubigeo CHAR(6),

    -- Procedencia del dato (RN-35): proveedor y momento de la consulta.
    fuente TEXT NOT NULL,
    consultado_en TIMESTAMPTZ,
    consultado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT empresas_ruc_11_digitos
        CHECK (ruc ~ '^[0-9]{11}$'),
    CONSTRAINT empresas_ruc_unico
        UNIQUE (ruc),
    CONSTRAINT empresas_razon_social_no_vacia
        CHECK (length(trim(razon_social)) > 0),
    CONSTRAINT empresas_estado_ruc_valido
        CHECK (estado_ruc IS NULL OR estado_ruc IN ('ACTIVO', 'BAJA', 'SUSPENSION TEMPORAL')),
    CONSTRAINT empresas_condicion_ruc_valida
        CHECK (condicion_ruc IS NULL OR condicion_ruc IN ('HABIDO', 'NO HABIDO', 'NO HALLADO')),
    CONSTRAINT empresas_ubigeo_6_digitos
        CHECK (ubigeo IS NULL OR ubigeo ~ '^[0-9]{6}$')
);

COMMENT ON TABLE public.empresas IS
    'Detalle de un prestatario EMPRESA (RUC). El cupo/deuda es del prestatario (CA-09), nunca imputado al DNI del representante.';
COMMENT ON COLUMN public.empresas.estado_ruc IS 'Estado SUNAT: ACTIVO | BAJA | SUSPENSION TEMPORAL.';
COMMENT ON COLUMN public.empresas.condicion_ruc IS 'Condición de domicilio SUNAT: HABIDO | NO HABIDO | NO HALLADO.';

-- ---------------------------------------------------------------------------
-- 5) Representantes/titulares de la empresa (CA-08, RN-36).
--    `persona_id` es un prestatario PERSONA_NATURAL (verificado en HU-02).
--    CA-08/B-07: sin autorización comprobada no se origina crédito empresarial;
--    por eso `autorizacion_comprobada` arranca en false.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.representantes_empresa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    empresa_id UUID NOT NULL
        REFERENCES public.empresas(prestatario_id) ON DELETE CASCADE,
    persona_id UUID NOT NULL
        REFERENCES public.prestatarios(id) ON DELETE RESTRICT,

    rol TEXT NOT NULL DEFAULT 'REPRESENTANTE_LEGAL',

    autorizacion_comprobada BOOLEAN NOT NULL DEFAULT FALSE,
    fuente TEXT,
    comprobado_en TIMESTAMPTZ,
    comprobado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT representantes_empresa_unico
        UNIQUE (empresa_id, persona_id),
    CONSTRAINT representantes_empresa_rol_valido
        CHECK (rol IN ('TITULAR', 'REPRESENTANTE_LEGAL')),
    CONSTRAINT representantes_autorizacion_con_fuente
        CHECK (
            autorizacion_comprobada = FALSE
            OR (fuente IS NOT NULL AND comprobado_en IS NOT NULL)
        )
);

COMMENT ON TABLE public.representantes_empresa IS
    'Vincula una empresa con la persona que la representa o es su titular. RUC activo NO prueba poderes vigentes (B-07).';

CREATE INDEX IF NOT EXISTS idx_representantes_empresa_persona
    ON public.representantes_empresa (persona_id);

-- ---------------------------------------------------------------------------
-- 6) Traza de auditoría de identidad (§5, RN-34): una fila por consulta,
--    con metadatos mínimos y SIN payload íntegro del proveedor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.validaciones_identidad (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    proveedor TEXT NOT NULL,
    tipo_documento TEXT NOT NULL,
    numero_documento TEXT NOT NULL,

    resultado TEXT NOT NULL,
    correlacion UUID,

    codigo_error TEXT,
    -- Mensaje mínimo del proveedor (nunca el JSON completo).
    mensaje TEXT,

    actor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT validaciones_identidad_proveedor_valido
        CHECK (proveedor IN ('SCRALL', 'APISPERU')),
    CONSTRAINT validaciones_identidad_tipo_valido
        CHECK (tipo_documento IN ('DNI', 'RUC')),
    CONSTRAINT validaciones_identidad_documento_formato
        CHECK (numero_documento ~ '^[0-9]{8,11}$'),
    CONSTRAINT validaciones_identidad_resultado_valido
        CHECK (resultado IN (
            'ENCONTRADO', 'NO_ENCONTRADO', 'RATE_LIMIT', 'ERROR_PROVEEDOR',
            'INCONSISTENTE', 'MENOR_EDAD', 'BLOQUEADO_ESTADO'
        ))
);

COMMENT ON TABLE public.validaciones_identidad IS
    'Auditoría de consultas de identidad: proveedor, resultado, correlación, fecha y actor. Sin payload íntegro (RN-34).';

CREATE INDEX IF NOT EXISTS idx_validaciones_identidad_documento
    ON public.validaciones_identidad (tipo_documento, numero_documento);
CREATE INDEX IF NOT EXISTS idx_validaciones_identidad_creado_en
    ON public.validaciones_identidad (creado_en DESC);

-- ---------------------------------------------------------------------------
-- 7) RLS: sin policies (acceso solo vía Edge Functions con service_role),
--    igual que `prestatarios`. 2.1.4 (lectura para supervisores) queda para HU-04.
-- ---------------------------------------------------------------------------
ALTER TABLE public.personas_naturales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.representantes_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.validaciones_identidad ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 8) RPC transaccionales (2.4.4): alta atómica de identidad sin fichas huérfanas.
--    SECURITY DEFINER + search_path fijo; ejecución restringida a service_role.
-- ---------------------------------------------------------------------------

-- Alta/reutilización de persona natural por DNI. Devuelve la ficha y los datos
-- almacenados (para detectar discrepancia de nombre en la Edge Function).
CREATE OR REPLACE FUNCTION public.registrar_persona_natural(
    p_dni CHAR(8),
    p_nombres TEXT,
    p_apellido_paterno TEXT,
    p_apellido_materno TEXT,
    p_fecha_nacimiento DATE,
    p_actor UUID
)
RETURNS TABLE (
    prestatario_id UUID,
    creado BOOLEAN,
    nombres TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    fecha_nacimiento DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    SELECT pn.prestatario_id, pn.nombres, pn.apellido_paterno, pn.apellido_materno, pn.fecha_nacimiento
      INTO v_id, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
      FROM public.personas_naturales pn
     WHERE pn.dni = p_dni;

    IF v_id IS NOT NULL THEN
        prestatario_id := v_id;
        creado := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    INSERT INTO public.prestatarios (tipo, creado_por)
    VALUES ('PERSONA_NATURAL', p_actor)
    RETURNING id INTO v_id;

    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno,
        fecha_nacimiento, fecha_validacion
    )
    VALUES (
        v_id, p_dni, p_nombres, p_apellido_paterno, p_apellido_materno,
        p_fecha_nacimiento, now()
    );

    prestatario_id := v_id;
    creado := TRUE;
    nombres := p_nombres;
    apellido_paterno := p_apellido_paterno;
    apellido_materno := p_apellido_materno;
    fecha_nacimiento := p_fecha_nacimiento;
    RETURN NEXT;

EXCEPTION WHEN unique_violation THEN
    -- Carrera: otro proceso creó la misma persona; se reutiliza.
    SELECT pn.prestatario_id, pn.nombres, pn.apellido_paterno, pn.apellido_materno, pn.fecha_nacimiento
      INTO prestatario_id, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
      FROM public.personas_naturales pn
     WHERE pn.dni = p_dni;
    creado := FALSE;
    RETURN NEXT;
END;
$$;

-- Alta/reutilización de empresa por RUC + vínculo opcional del representante.
-- `representante_estado`: VINCULADO | REPRESENTANTE_NO_VALIDADO |
--                         SIN_REPRESENTANTE | YA_REGISTRADA.
CREATE OR REPLACE FUNCTION public.registrar_empresa(
    p_ruc CHAR(11),
    p_razon_social TEXT,
    p_estado_ruc TEXT,
    p_condicion_ruc TEXT,
    p_direccion TEXT,
    p_departamento TEXT,
    p_provincia TEXT,
    p_distrito TEXT,
    p_ubigeo CHAR(6),
    p_fuente TEXT,
    p_actor UUID,
    p_representante_dni CHAR(8),
    p_representante_rol TEXT
)
RETURNS TABLE (
    prestatario_id UUID,
    creado BOOLEAN,
    representante_estado TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_prest UUID;
    v_persona UUID;
BEGIN
    SELECT e.prestatario_id INTO v_prest
      FROM public.empresas e WHERE e.ruc = p_ruc;
    IF v_prest IS NOT NULL THEN
        prestatario_id := v_prest;
        creado := FALSE;
        representante_estado := 'YA_REGISTRADA';
        RETURN NEXT;
        RETURN;
    END IF;

    -- Defensa en profundidad (CA-07/CA-08): aunque el único llamador sea la Edge
    -- Function, la función no debe aceptar RUC no habidos ni roles fuera de catálogo.
    IF p_estado_ruc IS DISTINCT FROM 'ACTIVO' OR p_condicion_ruc IS DISTINCT FROM 'HABIDO' THEN
        RAISE EXCEPTION 'Solo se registran RUC ACTIVO y HABIDO (CA-07)'
            USING ERRCODE = 'check_violation';
    END IF;
    IF p_representante_rol IS NOT NULL
       AND p_representante_rol NOT IN ('TITULAR', 'REPRESENTANTE_LEGAL') THEN
        RAISE EXCEPTION 'Rol de representante inválido'
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.prestatarios (tipo, creado_por)
    VALUES ('EMPRESA', p_actor)
    RETURNING id INTO v_prest;

    INSERT INTO public.empresas (
        prestatario_id, ruc, razon_social, estado_ruc, condicion_ruc,
        direccion, departamento, provincia, distrito, ubigeo,
        fuente, consultado_en, consultado_por
    )
    VALUES (
        v_prest, p_ruc, p_razon_social, p_estado_ruc, p_condicion_ruc,
        p_direccion, p_departamento, p_provincia, p_distrito, p_ubigeo,
        p_fuente, now(), p_actor
    );

    IF p_representante_dni IS NULL THEN
        representante_estado := 'SIN_REPRESENTANTE';
    ELSE
        SELECT pn.prestatario_id INTO v_persona
          FROM public.personas_naturales pn
         WHERE pn.dni = p_representante_dni;

        IF v_persona IS NULL THEN
            -- El representante debe validarse antes por el flujo HU-02.
            representante_estado := 'REPRESENTANTE_NO_VALIDADO';
        ELSE
            INSERT INTO public.representantes_empresa (
                empresa_id, persona_id, rol, autorizacion_comprobada, fuente
            )
            VALUES (v_prest, v_persona, COALESCE(p_representante_rol, 'REPRESENTANTE_LEGAL'), FALSE, 'DNI_HU02')
            ON CONFLICT (empresa_id, persona_id) DO NOTHING;
            representante_estado := 'VINCULADO';
        END IF;
    END IF;

    prestatario_id := v_prest;
    creado := TRUE;
    RETURN NEXT;

EXCEPTION WHEN unique_violation THEN
    SELECT e.prestatario_id INTO prestatario_id
      FROM public.empresas e WHERE e.ruc = p_ruc;
    creado := FALSE;
    representante_estado := 'YA_REGISTRADA';
    RETURN NEXT;
END;
$$;

-- Las RPC son SECURITY DEFINER (bypasean RLS), así que solo service_role (la
-- Edge Function) puede ejecutarlas. OJO: en Supabase el ACL por defecto concede
-- EXECUTE a PUBLIC/anon/authenticated, así que hay que revocárselo explícitamente;
-- `REVOKE ... FROM PUBLIC` a secas NO basta.
REVOKE ALL ON FUNCTION public.registrar_persona_natural(CHAR, TEXT, TEXT, TEXT, DATE, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_empresa(CHAR, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, CHAR, TEXT, UUID, CHAR, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_persona_natural(CHAR, TEXT, TEXT, TEXT, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_empresa(CHAR, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, CHAR, TEXT, UUID, CHAR, TEXT) TO service_role;
