-- HU-05: cuotas del cronograma y originación atómica del préstamo.
-- RN-06/07/08: TEA fija 0.30, plazo 1..60, principal > 0 sin mínimo comercial.
-- RN-16: el préstamo contiene fecha de originación.
-- RN-17: las cuotas contienen vencimiento, capital, interés y total.
-- RN-41: al originar se fija el cronograma pactado; sin edición silenciosa.
-- CA-14: cronograma francés con TEA 30 %, cálculo reproducible (motor EF/_shared).
-- CA-15/RN-31: alta atómica e idempotente; sin cuotas si la reserva falla.

-- ---------------------------------------------------------------------------
-- RN-16: fecha de originación del préstamo (1er vencimiento = +1 mes calendario)
-- ---------------------------------------------------------------------------
ALTER TABLE public.prestamos
    ADD COLUMN IF NOT EXISTS fecha_originacion DATE NOT NULL DEFAULT CURRENT_DATE;

COMMENT ON COLUMN public.prestamos.fecha_originacion IS
    'HU-05/RN-16: fecha de originación; los vencimientos se derivan de ella (+k meses).';

-- ---------------------------------------------------------------------------
-- 5.2: tabla de cuotas del cronograma
-- ---------------------------------------------------------------------------
CREATE TABLE public.cuotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prestamo_id UUID NOT NULL
        REFERENCES public.prestamos(id) ON DELETE RESTRICT,

    numero INTEGER NOT NULL,

    vencimiento DATE NOT NULL,

    capital_programado NUMERIC(12,2) NOT NULL,
    interes_programado NUMERIC(12,2) NOT NULL,
    total_programado NUMERIC(12,2) NOT NULL,

    -- 5.2.3: estado base persistido; VENCIDA es condición derivada en lectura.
    estado TEXT NOT NULL DEFAULT 'PENDIENTE',

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cuotas_numero_positivo
        CHECK (numero >= 1),

    CONSTRAINT cuotas_capital_no_negativo
        CHECK (capital_programado >= 0),

    CONSTRAINT cuotas_interes_no_negativo
        CHECK (interes_programado >= 0),

    CONSTRAINT cuotas_total_no_negativo
        CHECK (total_programado >= 0),

    -- RN-17: coherencia aritmética de cada fila.
    CONSTRAINT cuotas_total_coherente
        CHECK (total_programado = capital_programado + interes_programado),

    CONSTRAINT cuotas_estado_valido
        CHECK (estado IN ('PENDIENTE', 'PARCIAL', 'PAGADA')),

    -- 5.2.2
    CONSTRAINT cuotas_prestamo_numero_unico
        UNIQUE (prestamo_id, numero)
);

CREATE INDEX idx_cuotas_prestamo
    ON public.cuotas (prestamo_id);

CREATE INDEX idx_cuotas_pendientes_vencimiento
    ON public.cuotas (vencimiento)
    WHERE estado <> 'PAGADA';

COMMENT ON TABLE public.cuotas IS
    'HU-05: cronograma programado (francés, TEA 30 % fija; RN-17/RN-41/CA-14).';
COMMENT ON COLUMN public.cuotas.estado IS
    'Base: PENDIENTE/PARCIAL/PAGADA; VENCIDA se deriva en lectura (HU-07), no se persiste.';

-- RLS cerrada: todo vía Edge Functions con service_role (patrón HU-04).
ALTER TABLE public.cuotas ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5.3.3: originación atómica (préstamo + cuotas) e idempotente (RN-31/CA-15)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.originar_prestamo(
    p_prestatario_id UUID,
    p_monto NUMERIC(12,2),
    p_plazo_meses INTEGER,
    p_sucursal_id UUID,
    p_fecha_originacion DATE,
    p_creado_por UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_cuotas JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existente UUID;
    v_reserva JSONB;
    v_prestamo_id UUID;
    v_cuotas JSONB;
    v_suma_capital NUMERIC(12,2);
BEGIN
    -- RN-31/CA-15: misma idempotency_key devuelve préstamo + cuotas existentes.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existente
        FROM public.prestamos
        WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            SELECT jsonb_agg(jsonb_build_object(
                       'numero', c.numero,
                       'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
                       'capital', c.capital_programado,
                       'interes', c.interes_programado,
                       'total', c.total_programado,
                       'estado', c.estado
                   ) ORDER BY c.numero)
            INTO v_cuotas
            FROM public.cuotas c
            WHERE c.prestamo_id = v_existente;

            RETURN jsonb_build_object(
                'ok', true, 'idempotente', true,
                'prestamo_id', v_existente, 'motivo', NULL,
                'cuotas', COALESCE(v_cuotas, '[]'::jsonb)
            );
        END IF;
    END IF;

    IF p_monto IS NULL OR p_monto <= 0 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'MONTO_INVALIDO'
        );
    END IF;

    IF p_plazo_meses IS NULL OR p_plazo_meses NOT BETWEEN 1 AND 60 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'PLAZO_INVALIDO'
        );
    END IF;

    IF p_fecha_originacion IS NULL OR p_fecha_originacion > CURRENT_DATE THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'FECHA_INVALIDA'
        );
    END IF;

    -- CA-14: el cronograma llega calculado (motor EF/_shared); aquí se validan
    -- los invariantes de servidor (defensa en profundidad, sin doble matemática).
    IF p_cuotas IS NULL OR jsonb_typeof(p_cuotas) <> 'array'
        OR jsonb_array_length(p_cuotas) <> p_plazo_meses THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- Filas coherentes: totales, no negatividad y vencimiento posterior a la originación.
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_cuotas) c
        WHERE (c->>'numero') IS NULL
           OR (c->>'vencimiento') IS NULL
           OR (c->>'capital') IS NULL
           OR (c->>'interes') IS NULL
           OR (c->>'total') IS NULL
           OR (c->>'capital')::numeric < 0
           OR (c->>'interes')::numeric < 0
           OR (c->>'total')::numeric <> (c->>'capital')::numeric + (c->>'interes')::numeric
           OR (c->>'vencimiento')::date <= p_fecha_originacion
    ) THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- Números consecutivos 1..n (5.2.2 aplicado antes del insert).
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_cuotas) WITH ORDINALITY t(c, ord)
        WHERE (c->>'numero')::integer <> t.ord
    ) THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- 5.7.1: la suma de capitales programados debe igualar el principal (tol. 0.01).
    SELECT COALESCE(SUM((c->>'capital')::numeric), 0)
    INTO v_suma_capital
    FROM jsonb_array_elements(p_cuotas) c;

    IF ABS(v_suma_capital - p_monto) > 0.01 THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'CRONOGRAMA_INVALIDO'
        );
    END IF;

    -- Reserva de cupo + elegibilidad (HU-04, RN-09/15/32): misma transacción.
    v_reserva := public.reservar_cupo(
        p_prestatario_id, p_monto, p_plazo_meses,
        p_sucursal_id, p_creado_por, p_idempotency_key
    );
    IF NOT (v_reserva->>'ok')::boolean THEN
        RETURN v_reserva || jsonb_build_object('idempotente', false);
    END IF;

    v_prestamo_id := (v_reserva->>'prestamo_id')::uuid;

    -- Reserva idempotente (carrera con la misma key): las cuotas ya se crearon.
    IF (v_reserva->>'idempotente')::boolean THEN
        SELECT jsonb_agg(jsonb_build_object(
                   'numero', c.numero,
                   'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
                   'capital', c.capital_programado,
                   'interes', c.interes_programado,
                   'total', c.total_programado,
                   'estado', c.estado
               ) ORDER BY c.numero)
        INTO v_cuotas
        FROM public.cuotas c
        WHERE c.prestamo_id = v_prestamo_id;

        RETURN jsonb_build_object(
            'ok', true, 'idempotente', true,
            'prestamo_id', v_prestamo_id, 'motivo', NULL,
            'cuotas', COALESCE(v_cuotas, '[]'::jsonb)
        );
    END IF;

    UPDATE public.prestamos
    SET fecha_originacion = p_fecha_originacion
    WHERE id = v_prestamo_id;

    INSERT INTO public.cuotas (
        prestamo_id, numero, vencimiento,
        capital_programado, interes_programado, total_programado
    )
    SELECT
        v_prestamo_id,
        (c->>'numero')::integer,
        (c->>'vencimiento')::date,
        (c->>'capital')::numeric,
        (c->>'interes')::numeric,
        (c->>'total')::numeric
    FROM jsonb_array_elements(p_cuotas) c;

    SELECT jsonb_agg(jsonb_build_object(
               'numero', c.numero,
               'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
               'capital', c.capital_programado,
               'interes', c.interes_programado,
               'total', c.total_programado,
               'estado', c.estado
           ) ORDER BY c.numero)
    INTO v_cuotas
    FROM public.cuotas c
    WHERE c.prestamo_id = v_prestamo_id;

    RETURN jsonb_build_object(
        'ok', true, 'idempotente', false,
        'prestamo_id', v_prestamo_id, 'motivo', NULL,
        'cuotas', v_cuotas
    );
END;
$$;

COMMENT ON FUNCTION public.originar_prestamo(UUID, NUMERIC, INTEGER, UUID, DATE, UUID, TEXT, JSONB) IS
    'HU-05/CA-15/RN-31: originación atómica (reserva de cupo HU-04 + cuotas validadas); idempotente por p_idempotency_key.';

REVOKE ALL ON FUNCTION public.originar_prestamo(UUID, NUMERIC, INTEGER, UUID, DATE, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.originar_prestamo(UUID, NUMERIC, INTEGER, UUID, DATE, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.originar_prestamo(UUID, NUMERIC, INTEGER, UUID, DATE, UUID, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.originar_prestamo(UUID, NUMERIC, INTEGER, UUID, DATE, UUID, TEXT, JSONB) TO service_role;
