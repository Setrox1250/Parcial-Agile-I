-- HU-06: confirmación de desembolso (CA-16/CA-17) y anulación previa.
-- RN-31: la transición de estado ocurre en una única función transaccional
--        con FOR UPDATE sobre la fila del préstamo; RN-30: la sucursal del
--        préstamo es la del origen y no se altera (la autoriza la EF).
-- CA-16: evidencia mínima del desembolso (importe, método, referencia,
--        actor, sucursal y fecha) en la tabla `desembolsos`.
-- CA-17: una sola confirmación por préstamo (`prestamo_id` UNIQUE); la
--        anulación antes del desembolso libera la reserva de cupo
--        (función `liberar_reserva` de HU-04).

-- ---------------------------------------------------------------------------
-- 1) Evidencia del desembolso confirmado.
-- ---------------------------------------------------------------------------
CREATE TABLE public.desembolsos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- CA-17: doble confirmación rechazada => una fila por préstamo.
    prestamo_id UUID NOT NULL UNIQUE
        REFERENCES public.prestamos(id) ON DELETE RESTRICT,

    importe NUMERIC(12,2) NOT NULL,

    metodo TEXT NOT NULL,
    referencia TEXT,

    -- Sucursal que entregó el dinero (evidencia CA-16; heredada del préstamo).
    sucursal_id UUID NOT NULL
        REFERENCES public.sucursales(id) ON DELETE RESTRICT,

    -- Quién confirmó la entrega (CA-16, CA-28).
    confirmo UUID
        REFERENCES auth.users(id) ON DELETE SET NULL,

    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- RN-31: reintentos con la misma clave devuelven el mismo desembolso.
    idempotency_key TEXT,

    CONSTRAINT desembolsos_importe_positivo
        CHECK (importe > 0),
    CONSTRAINT desembolsos_metodo_valido
        CHECK (metodo IN ('EFECTIVO', 'TRANSFERENCIA')),
    -- La transferencia exige referencia verificable; el efectivo no.
    CONSTRAINT desembolsos_referencia_por_metodo
        CHECK (
            (metodo = 'TRANSFERENCIA' AND length(trim(referencia)) > 0)
            OR (metodo = 'EFECTIVO' AND referencia IS NULL)
        ),
    CONSTRAINT desembolsos_idempotency_unico
        UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.desembolsos IS
    'Evidencia mínima del desembolso confirmado (HU-06/CA-16): importe, método, referencia, actor, sucursal y fecha. Histórico; no se edita (RN-33).';
COMMENT ON COLUMN public.desembolsos.importe IS
    'Importe entregado; debe coincidir con el principal contratado del préstamo.';
COMMENT ON COLUMN public.desembolsos.referencia IS
    'Referencia del abono solo para TRANSFERENCIA (CA-16); EFECTIVO la guarda en NULL por CHECK.';

CREATE INDEX idx_desembolsos_prestamo
    ON public.desembolsos (prestamo_id);

-- ---------------------------------------------------------------------------
-- 2) Confirmación transaccional del desembolso.
--    Cambia PENDIENTE_DESEMBOLSO -> ACTIVO: la reserva de cupo pasa a ser
--    capital insoluto (RN-09), sin alterar el principal ni la TEA (RN-06).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_desembolso(
    p_prestamo_id UUID,
    p_metodo TEXT,
    p_referencia TEXT,
    p_confirmo UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prestamo public.prestamos%ROWTYPE;
    v_desembolso_id UUID;
    v_existente UUID;
BEGIN
    -- RN-31: mismo idempotency_key => el desembolso ya confirmado (CA-17 no
    -- aplica al reintento del mismo envío, sino a un segundo envío distinto).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT prestamo_id INTO v_existente
        FROM public.desembolsos
        WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'ok', true, 'idempotente', true,
                'prestamo_id', v_existente, 'motivo', NULL
            );
        END IF;
    END IF;

    IF p_metodo NOT IN ('EFECTIVO', 'TRANSFERENCIA') THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'METODO_INVALIDO'
        );
    END IF;

    IF p_metodo = 'TRANSFERENCIA'
       AND (p_referencia IS NULL OR length(trim(p_referencia)) = 0) THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'REFERENCIA_REQUERIDA'
        );
    END IF;

    IF p_metodo = 'EFECTIVO' THEN
        p_referencia := NULL;
    END IF;

    -- Serializa contra confirmaciones/ liberaciones concurrentes del préstamo.
    SELECT * INTO v_prestamo
    FROM public.prestamos
    WHERE id = p_prestamo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'PRESTAMO_INEXISTENTE'
        );
    END IF;

    IF v_prestamo.estado <> 'PENDIENTE_DESEMBOLSO' THEN
        -- CA-17: ya existe confirmación (u otra transición) => rechazo limpio.
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', p_prestamo_id, 'estado', v_prestamo.estado,
            'motivo', CASE WHEN v_prestamo.estado = 'ACTIVO'
                           THEN 'DESEMBOLLO_YA_CONFIRMADO'
                           ELSE 'ESTADO_NO_DESEMBOLLABLE' END
        );
    END IF;

    BEGIN
        -- Evidencia CA-16: importe = principal contratado, sucursal de origen.
        INSERT INTO public.desembolsos (
            prestamo_id, importe, metodo, referencia,
            sucursal_id, confirmo, idempotency_key
        ) VALUES (
            v_prestamo.id, v_prestamo.principal, p_metodo, p_referencia,
            v_prestamo.sucursal_id, p_confirmo, p_idempotency_key
        )
        RETURNING id INTO v_desembolso_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', p_prestamo_id, 'motivo', 'DESEMBOLLO_YA_CONFIRMADO'
        );
    END;

    UPDATE public.prestamos
    SET estado = 'ACTIVO',
        capital_insoluto = principal,
        reserva_capital = 0,
        desembolsado_en = now(),
        actualizado_en = now()
    WHERE id = v_prestamo.id;

    RETURN jsonb_build_object(
        'ok', true, 'idempotente', false,
        'prestamo_id', v_prestamo.id,
        'desembolso_id', v_desembolso_id,
        'estado', 'ACTIVO',
        'importe', v_prestamo.principal,
        'motivo', NULL
    );
END;
$$;

COMMENT ON FUNCTION public.confirmar_desembolso(UUID, TEXT, TEXT, UUID, TEXT) IS
    'CA-16/CA-17/RN-31: confirma el desembolso de un préstamo PENDIENTE_DESEMBOLSO, registra la evidencia y lo activa; doble confirmación se rechaza y la misma idempotency_key es idempotente.';

-- ---------------------------------------------------------------------------
-- 3) Privilegios: solo service_role (Edge Functions); nada para el cliente
--    (RN-34/CA-30). El REVOKE debe nombrar explícitamente a anon y
--    authenticated: en Supabase los ALTER DEFAULT PRIVILEGES del schema
--    public les conceden EXECUTE por defecto a cada función nueva, y quitar
--    solo el PUBLIC no basta (la HU-03 ya detectó este mismo hueco).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.confirmar_desembolso(UUID, TEXT, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_desembolso(UUID, TEXT, TEXT, UUID, TEXT) TO service_role;

-- RLS: acceso denegado al cliente; toda lectura/escritura vía Edge Functions
-- con service_role (convención de todas las tablas del MVP).
ALTER TABLE public.desembolsos ENABLE ROW LEVEL SECURITY;
