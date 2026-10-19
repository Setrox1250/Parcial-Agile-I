-- HU-08: observabilidad y reintentos del proceso diario de mora.
-- Cada ejecución conserva sus intentos para permitir diagnóstico sin exponer
-- información de identidad o payloads de operaciones.

CREATE TABLE public.ejecuciones_mora (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ejecucion_id UUID NOT NULL,
    fecha_operativa DATE NOT NULL,
    intento SMALLINT NOT NULL CHECK (intento BETWEEN 1 AND 3),
    estado TEXT NOT NULL CHECK (estado IN ('EXITOSO', 'FALLIDO')),
    iniciado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    resultado JSONB,
    error_codigo TEXT,
    error_detalle TEXT,
    CONSTRAINT uq_ejecuciones_mora_intento UNIQUE (ejecucion_id, intento)
);

CREATE INDEX idx_ejecuciones_mora_fecha ON public.ejecuciones_mora (iniciado_en DESC);
ALTER TABLE public.ejecuciones_mora ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ejecuciones_mora FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.procesar_mora_con_reintentos(
    p_fecha DATE DEFAULT NULL,
    p_max_intentos SMALLINT DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fecha DATE := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Lima')::date);
    v_ejecucion UUID := gen_random_uuid();
    v_intento SMALLINT;
    v_max_intentos SMALLINT := LEAST(GREATEST(COALESCE(p_max_intentos, 3), 1), 3);
    v_resultado JSONB;
    v_sqlstate TEXT;
    v_error TEXT;
BEGIN
    FOR v_intento IN 1..v_max_intentos LOOP
        BEGIN
            v_resultado := public.procesar_mora(v_fecha);

            INSERT INTO public.ejecuciones_mora (
                ejecucion_id, fecha_operativa, intento, estado, resultado
            ) VALUES (
                v_ejecucion, v_fecha, v_intento, 'EXITOSO', v_resultado
            );

            RETURN v_resultado || jsonb_build_object(
                'ejecucion_id', v_ejecucion,
                'intentos', v_intento
            );
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS
                v_sqlstate = RETURNED_SQLSTATE,
                v_error = MESSAGE_TEXT;

            INSERT INTO public.ejecuciones_mora (
                ejecucion_id, fecha_operativa, intento, estado, error_codigo, error_detalle
            ) VALUES (
                v_ejecucion, v_fecha, v_intento, 'FALLIDO', v_sqlstate, left(v_error, 500)
            );

            IF v_intento < v_max_intentos THEN
                PERFORM pg_sleep(v_intento * 0.2);
            END IF;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', false,
        'fecha', to_char(v_fecha, 'YYYY-MM-DD'),
        'ejecucion_id', v_ejecucion,
        'intentos', v_max_intentos,
        'motivo', 'REINTENTOS_AGOTADOS'
    );
END;
$$;

COMMENT ON FUNCTION public.procesar_mora_con_reintentos(DATE, SMALLINT) IS
    'HU-08: ejecuta procesar_mora con hasta tres intentos y registra cada resultado para operación y diagnóstico.';

REVOKE ALL ON FUNCTION public.procesar_mora_con_reintentos(DATE, SMALLINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.procesar_mora_con_reintentos(DATE, SMALLINT) TO service_role;

-- Sustituye el job original para que el cron ejecute la envoltura con reintentos.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'procesar-mora-diaria-lima';

SELECT cron.schedule(
    'procesar-mora-diaria-lima',
    '5 5 * * *',
    $$SELECT public.procesar_mora_con_reintentos();$$
);
