-- HU-04: estructura de mora y cobranza extrajudicial (el motor de detección
-- y escalamiento es HU-08; aquí se crean las tablas para cumplir RN-15/CP-14/CP-15
-- desde la elegibilidad).
-- RN-26/§4.4: la mora inicia al día siguiente del vencimiento sin gracia.
-- RN-38: fechas en zona America/Lima. CP-23: un solo expediente por racha.

CREATE TABLE public.eventos_mora (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prestamo_id UUID NOT NULL
        REFERENCES public.prestamos(id) ON DELETE RESTRICT,

    -- Primer día en que existió al menos una cuota en mora (§4.4).
    inicio_mora DATE NOT NULL,

    -- NULL = racha abierta; fecha de regularización total de cuotas vencidas.
    fecha_fin DATE,

    monto_vencido NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- Copia mínima del cronograma que originó la mora (§5); sin datos personales (RN-34).
    evidencia JSONB,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT eventos_mora_monto_no_negativo
        CHECK (monto_vencido >= 0),

    CONSTRAINT eventos_mora_fechas_coherentes
        CHECK (fecha_fin IS NULL OR fecha_fin >= inicio_mora)
);

COMMENT ON TABLE public.eventos_mora IS
    'Racha de mora continua por préstamo. RN-28: el histórico no se elimina; el cierre se registra en fecha_fin.';

-- Una sola racha abierta por préstamo a la vez (RN-26, §4.4).
CREATE UNIQUE INDEX uq_eventos_mora_abierta
    ON public.eventos_mora (prestamo_id)
    WHERE fecha_fin IS NULL;

CREATE INDEX idx_eventos_mora_prestamo
    ON public.eventos_mora (prestamo_id);

CREATE TABLE public.expdedientes_extrajudicial (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prestamo_id UUID NOT NULL
        REFERENCES public.prestamos(id) ON DELETE RESTRICT,

    -- Un solo expediente por racha de mora (CP-23).
    evento_mora_id UUID NOT NULL UNIQUE
        REFERENCES public.eventos_mora(id) ON DELETE RESTRICT,

    fecha_escalamiento DATE NOT NULL,

    estado TEXT NOT NULL DEFAULT 'ABIERTO',

    -- B-08: responsable administrativo del expediente (definición pendiente de ratificar).
    responsable UUID
        REFERENCES auth.users(id) ON DELETE SET NULL,

    accion TEXT,
    resultado TEXT,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT expedientes_estado_valido
        CHECK (estado IN ('ABIERTO', 'CERRADO'))
);

COMMENT ON TABLE public.expdedientes_extrajudicial IS
    'Expediente de cobranza EXTRAJUDICIAL por racha (RN-27/CP-23). RN-28: histórico inmutable; no sustituye saldo del préstamo.';

-- RLS: sin acceso de cliente; solo Edge Functions con service_role.
ALTER TABLE public.eventos_mora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expdedientes_extrajudicial ENABLE ROW LEVEL SECURITY;
