-- HU-10: retención controlada y resultado explícito de la bitácora.

ALTER TABLE public.auditoria
    ADD COLUMN IF NOT EXISTS resultado TEXT NOT NULL DEFAULT 'EXITOSO'
    CHECK (resultado IN ('EXITOSO', 'RECHAZADO', 'ERROR'));

CREATE INDEX IF NOT EXISTS idx_auditoria_filtros
    ON public.auditoria (resultado, accion, sucursal_id, fecha DESC);

-- La bitácora no admite mutaciones directas. Solo la función de retención,
-- ejecutada con SECURITY DEFINER, puede eliminar registros expirados.
CREATE OR REPLACE FUNCTION public.bloquear_mutacion_auditoria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('app.permitir_purga_auditoria', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AUDITORIA_INMUTABLE';
END;
$$;

CREATE OR REPLACE FUNCTION public.depurar_auditoria(
    p_retencion INTERVAL DEFAULT INTERVAL '5 years'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_eliminados INTEGER;
BEGIN
    IF p_retencion < INTERVAL '1 year' THEN
        RAISE EXCEPTION 'RETENCION_MINIMA_UN_ANIO';
    END IF;
    PERFORM set_config('app.permitir_purga_auditoria', 'on', true);
    DELETE FROM public.auditoria WHERE fecha < now() - p_retencion;
    GET DIAGNOSTICS v_eliminados = ROW_COUNT;
    RETURN v_eliminados;
END;
$$;

REVOKE ALL ON FUNCTION public.depurar_auditoria(INTERVAL)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.depurar_auditoria(INTERVAL) TO service_role;

SELECT cron.schedule(
    'depurar-auditoria-mensual',
    '15 5 1 * *',
    $$SELECT public.depurar_auditoria();$$
)
WHERE NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'depurar-auditoria-mensual'
);
