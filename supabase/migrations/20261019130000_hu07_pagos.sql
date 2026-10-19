-- HU-07 (base sin cronograma): registro y verificación de cobranzas.
--
-- Alcance de esta migración: `pagos` con sus estados (§5), registro
-- idempotente sobre un préstamo ACTIVO y verificación manual de
-- transferencias (RN-23, §4.3.5). La imputación a cuotas capital/interés
-- (CA-19..CA-21, CP-12/CP-13/CP-17..CP-21) requiere la tabla `cuotas` de
-- HU-05 y se aplicará en la continuación de esta HU; la columna
-- `imputado_en` deja preparado ese paso (NULL = cobro por imputar) sin
-- alterar todavía capital insoluto ni cupo (RN-11).
--
-- RN-31: transacción e idempotencia por idempotency_key.
-- RN-33: los pagos no se editan ni se borran; solo cambian de estado hacia
--        adelante (verificación) o mediante reversión compensatoria (HU-10).

-- ---------------------------------------------------------------------------
-- 1) Cobro registrado (efectivo confirmado al momento; transferencia a la
--    espera de verificación manual del abono).
-- ---------------------------------------------------------------------------
CREATE TABLE public.pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prestamo_id UUID NOT NULL
        REFERENCES public.prestamos(id) ON DELETE RESTRICT,

    monto NUMERIC(12,2) NOT NULL,

    medio TEXT NOT NULL,
    referencia TEXT,

    estado TEXT NOT NULL DEFAULT 'REGISTRADO',

    -- Quién registra el cobro y quién verifica/confirma (CA-16/CA-28).
    registra UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    confirma UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmado_en TIMESTAMPTZ,

    -- NULL = cobro confirmado aún no imputado a cuotas (continuación HU-07
    -- cuando exista el cronograma de HU-05).
    imputado_en TIMESTAMPTZ,

    idempotency_key TEXT,

    CONSTRAINT pagos_monto_positivo
        CHECK (monto > 0),
    CONSTRAINT pagos_medio_valido
        CHECK (medio IN ('EFECTIVO', 'TRANSFERENCIA')),
    CONSTRAINT pagos_estado_valido
        CHECK (estado IN (
            'REGISTRADO', 'PENDIENTE_VERIFICACION', 'CONFIRMADO',
            'RECHAZADO', 'REVERSADO'
        )),
    CONSTRAINT pagos_referencia_por_medio
        CHECK (
            (medio = 'TRANSFERENCIA'
                AND COALESCE(length(trim(referencia)), 0) > 0)
            OR (medio = 'EFECTIVO' AND referencia IS NULL)
        ),
    -- §4.3.5: el efectivo se confirma al registrarlo; la transferencia pasa
    -- por verificación manual y no altera saldos hasta entonces (RN-23).
    CONSTRAINT pagos_estado_por_medio
        CHECK (
            (medio = 'EFECTIVO' AND estado IN ('CONFIRMADO', 'RECHAZADO', 'REVERSADO'))
            OR (medio = 'TRANSFERENCIA'
                AND estado IN ('PENDIENTE_VERIFICACION', 'CONFIRMADO', 'RECHAZADO', 'REVERSADO'))
        ),
    CONSTRAINT pagos_confirmado_con_fecha
        CHECK (
            estado NOT IN ('CONFIRMADO', 'RECHAZADO', 'REVERSADO')
            OR confirmado_en IS NOT NULL
        ),
    CONSTRAINT pagos_imputado_es_confirmado
        CHECK (imputado_en IS NULL OR estado = 'CONFIRMADO'),
    CONSTRAINT pagos_idempotency_unico
        UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.pagos IS
    'Cobros de la HU-07. RN-33: histórico inmutable; los estados solo avanzan (verificación) o se revierten con asiento compensatorio (HU-10).';
COMMENT ON COLUMN public.pagos.estado IS
    'REGISTRADO | PENDIENTE_VERIFICACION (transferencia sin abono confirmado, RN-23) | CONFIRMADO | RECHAZADO | REVERSADO.';
COMMENT ON COLUMN public.pagos.imputado_en IS
    'NULL mientras la imputación a cuotas (capital/interés) no exista: pendiente de HU-05 + continuación de HU-07 (RN-11/RN-22).';
COMMENT ON COLUMN public.pagos.idempotency_key IS
    'RN-31/CP-28: un reintento del mismo cobro devuelve el mismo pago, sin duplicarlo.';

CREATE INDEX idx_pagos_prestamo ON public.pagos (prestamo_id, estado);
CREATE INDEX idx_pagos_por_imputar
    ON public.pagos (confirmado_en)
    WHERE estado = 'CONFIRMADO' AND imputado_en IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Registro de cobro sobre un préstamo ACTIVO (CA-18 de la base).
--    La comprobación `monto <= deuda programada` exige el cronograma (HU-05)
--    y se aplica junto con la imputación; aquí solo se garantiza monto > 0,
--    préstamo desembolsado e idempotencia.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_pago(
    p_prestamo_id UUID,
    p_monto NUMERIC(12,2),
    p_medio TEXT,
    p_referencia TEXT,
    p_registra UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_estado_prestamo TEXT;
    v_pago_id UUID;
    v_existente UUID;
    v_estado TEXT;
BEGIN
    -- RN-31/CP-28: mismo idempotency_key => el pago ya registrado.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existente
        FROM public.pagos
        WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'ok', true, 'idempotente', true,
                'pago_id', v_existente, 'motivo', NULL
            );
        END IF;
    END IF;

    IF p_monto IS NULL OR p_monto <= 0 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'pago_id', NULL, 'motivo', 'MONTO_INVALIDO'
        );
    END IF;

    IF p_medio NOT IN ('EFECTIVO', 'TRANSFERENCIA') THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'pago_id', NULL, 'motivo', 'MEDIO_INVALIDO'
        );
    END IF;

    IF p_medio = 'TRANSFERENCIA'
       AND (p_referencia IS NULL OR length(trim(p_referencia)) = 0) THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'pago_id', NULL, 'motivo', 'REFERENCIA_REQUERIDA'
        );
    END IF;

    IF p_medio = 'EFECTIVO' THEN
        p_referencia := NULL;
        -- §4.3.5: el efectivo se confirma por responsable autorizado al
        -- registrarlo; el mismo actor queda como confirmador.
        v_estado := 'CONFIRMADO';
    ELSE
        v_estado := 'PENDIENTE_VERIFICACION';
    END IF;

    -- RN-31: serializa cobros concurrentes del mismo préstamo.
    SELECT estado INTO v_estado_prestamo
    FROM public.prestamos
    WHERE id = p_prestamo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'pago_id', NULL, 'motivo', 'PRESTAMO_INEXISTENTE'
        );
    END IF;

    -- CA-18: solo se cobra sobre un préstamo desembolsado (ACTIVO).
    IF v_estado_prestamo <> 'ACTIVO' THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'pago_id', NULL, 'estado_prestamo', v_estado_prestamo,
            'motivo', 'PRESTAMO_NO_ACTIVO'
        );
    END IF;

    BEGIN
        INSERT INTO public.pagos (
            prestamo_id, monto, medio, referencia, estado,
            registra, confirma, confirmado_en, idempotency_key
        ) VALUES (
            p_prestamo_id, p_monto, p_medio, p_referencia, v_estado,
            p_registra,
            CASE WHEN v_estado = 'CONFIRMADO' THEN p_registra ELSE NULL END,
            CASE WHEN v_estado = 'CONFIRMADO' THEN now() ELSE NULL END,
            p_idempotency_key
        )
        RETURNING id INTO v_pago_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_existente
        FROM public.pagos
        WHERE idempotency_key = p_idempotency_key;
        RETURN jsonb_build_object(
            'ok', true, 'idempotente', true,
            'pago_id', v_existente, 'motivo', NULL
        );
    END;

    RETURN jsonb_build_object(
        'ok', true, 'idempotente', false,
        'pago_id', v_pago_id, 'estado', v_estado, 'motivo', NULL
    );
END;
$$;

COMMENT ON FUNCTION public.registrar_pago(UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) IS
    'CA-18/RN-31/RN-32: registra un cobro sobre un préstamo ACTIVO. Efectivo -> CONFIRMADO; transferencia -> PENDIENTE_VERIFICACION (RN-23). Idempotente por p_idempotency_key.';

-- ---------------------------------------------------------------------------
-- 3) Verificación manual del abono de una transferencia (§4.3.5).
--    Solo una transferencia PENDIENTE_VERIFICACION puede confirmarse o
--    rechazarse; cada intento queda con actor y fecha (CA-27/CA-28).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_pago(
    p_pago_id UUID,
    p_accion TEXT,
    p_confirma UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pago public.pagos%ROWTYPE;
    v_pago_id UUID := p_pago_id;
    v_estado TEXT;
BEGIN
    -- La acción se valida primero: es rechazo de la petición, no del estado.
    v_estado := CASE p_accion WHEN 'CONFIRMAR' THEN 'CONFIRMADO'
                              WHEN 'RECHAZAR' THEN 'RECHAZADO'
                              ELSE NULL END;
    IF v_estado IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'pago_id', v_pago_id, 'estado', NULL,
            'motivo', 'ACCION_INVALIDA'
        );
    END IF;

    SELECT * INTO v_pago
    FROM public.pagos
    WHERE id = p_pago_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'pago_id', NULL, 'motivo', 'PAGO_INEXISTENTE'
        );
    END IF;

    IF v_pago.estado <> 'PENDIENTE_VERIFICACION' THEN
        RETURN jsonb_build_object(
            'ok', false, 'pago_id', v_pago_id, 'estado', v_pago.estado,
            'motivo', 'ESTADO_NO_VERIFICABLE'
        );
    END IF;

    UPDATE public.pagos
    SET estado = v_estado,
        confirma = p_confirma,
        confirmado_en = now()
    WHERE id = p_pago_id;

    RETURN jsonb_build_object(
        'ok', true, 'pago_id', v_pago_id, 'estado', v_estado, 'motivo', NULL
    );
END;
$$;

COMMENT ON FUNCTION public.verificar_pago(UUID, TEXT, UUID) IS
    '§4.3.5/RN-23: confirma o rechaza manualmente la transferencia pendiente; no permite repetir la verificación (RN-33).';

-- ---------------------------------------------------------------------------
-- 4) Privilegios: solo service_role, con REVOKE explícito a anon y
--    authenticated (CA-30/RN-34; los DEFAULT PRIVILEGES de Supabase conceden
--    EXECUTE por defecto a esos roles en todo objeto nuevo del schema public).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.registrar_pago(UUID, NUMERIC, TEXT, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verificar_pago(UUID, TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago(UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verificar_pago(UUID, TEXT, UUID) TO service_role;

-- RLS: acceso denegado al cliente; todo vía Edge Functions con service_role.
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

-- Los DEFAULT PRIVILEGES de Supabase conceden ALL sobre tablas nuevas a
-- anon/authenticated: además de la RLS, se les retira el privilegio de
-- tabla (RN-33: el histórico de cobros no se escribe ni se borra por SQL).
REVOKE ALL ON public.pagos FROM anon, authenticated;
