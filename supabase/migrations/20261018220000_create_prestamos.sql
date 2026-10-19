-- HU-04: tabla de préstamos (reserva de cupo y exposición global).
-- RN-06: TEA fija 0.30. RN-07: plazo 1..60. RN-08: principal > 0, sin mínimo comercial.
-- RN-09: exposición = capital_insoluto ACTIVO + reserva_capital PENDIENTE_DESEMBOLSO.
-- RN-16/§5: campos mínimos del préstamo. Reserva atómica e idempotente en
--           20261018220200_funciones_elegibilidad_cupo.sql.

CREATE TABLE public.prestamos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    prestatario_id UUID NOT NULL
        REFERENCES public.prestatarios(id) ON DELETE RESTRICT,

    sucursal_id UUID NOT NULL
        REFERENCES public.sucursales(id) ON DELETE RESTRICT,

    -- Usuario que originó el préstamo (auditoría HU-10/CA-28).
    creado_por UUID
        REFERENCES auth.users(id) ON DELETE SET NULL,

    principal NUMERIC(12,2) NOT NULL,
    capital_insoluto NUMERIC(12,2) NOT NULL DEFAULT 0,
    reserva_capital NUMERIC(12,2) NOT NULL DEFAULT 0,

    tea NUMERIC(6,5) NOT NULL DEFAULT 0.30,
    plazo_meses INTEGER NOT NULL,

    estado TEXT NOT NULL DEFAULT 'PENDIENTE_DESEMBOLSO',

    idempotency_key TEXT,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    desembolsado_en TIMESTAMPTZ,

    CONSTRAINT prestamos_principal_positivo
        CHECK (principal > 0 AND principal <= 10000),

    CONSTRAINT prestamos_capital_insoluto_valido
        CHECK (capital_insoluto >= 0 AND capital_insoluto <= principal),

    CONSTRAINT prestamos_reserva_valida
        CHECK (reserva_capital >= 0 AND reserva_capital <= principal),

    CONSTRAINT prestamos_tea_fija
        CHECK (tea = 0.30),

    CONSTRAINT prestamos_plazo_rango
        CHECK (plazo_meses BETWEEN 1 AND 60),

    CONSTRAINT prestamos_estado_valido
        CHECK (estado IN ('PENDIENTE_DESEMBOLSO', 'ACTIVO', 'PAGADO', 'ANULADO_SIN_DESEMBOLSO')),

    -- Importes coherentes con el estado: es la fuente de confianza de la exposición (RN-09).
    CONSTRAINT prestamos_importes_coherentes
        CHECK (
            (
                estado = 'PENDIENTE_DESEMBOLSO'
                AND capital_insoluto = 0
                AND reserva_capital = principal
            )
            OR (
                estado = 'ACTIVO'
                AND reserva_capital = 0
                AND capital_insoluto > 0
                AND capital_insoluto <= principal
            )
            OR (
                estado IN ('PAGADO', 'ANULADO_SIN_DESEMBOLSO')
                AND capital_insoluto = 0
                AND reserva_capital = 0
            )
        ),

    -- RN-31: una sola operación por idempotency_key (varias NULL).
    CONSTRAINT prestamos_idempotency_unico
        UNIQUE (idempotency_key)
);

COMMENT ON TABLE public.prestamos IS
    'Préstamo multisucursal. PENDIENTE_DESEMBOLSO reserva cupo (reserva_capital); ACTIVO suma capital_insoluto a la exposición (RN-09).';
COMMENT ON COLUMN public.prestamos.reserva_capital IS
    'Capital reservado mientras espera desembolso; libera cupo al anular (CA-17) o al confirmar desembolso (pasa a capital_insoluto).';
COMMENT ON COLUMN public.prestamos.idempotency_key IS
    'Clave de idempotencia de la originación (RN-31/CA-15); NULL solo en filas de prueba.';

CREATE INDEX idx_prestamos_prestatario
    ON public.prestamos (prestatario_id);

CREATE INDEX idx_prestamos_sucursal_estado
    ON public.prestamos (sucursal_id, estado);

CREATE INDEX idx_prestamos_exposicion
    ON public.prestamos (prestatario_id)
    WHERE estado IN ('ACTIVO', 'PENDIENTE_DESEMBOLSO');

-- RLS: acceso denegado al cliente; todo vía Edge Functions con service_role
-- (misma convención que 0.5.2 y la HU-02).
ALTER TABLE public.prestamos ENABLE ROW LEVEL SECURITY;
