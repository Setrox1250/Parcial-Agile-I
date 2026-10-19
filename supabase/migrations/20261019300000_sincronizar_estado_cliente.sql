-- El estado operativo de la ficha se mantiene alineado con la cartera.
-- Los estados bloqueados por decisión administrativa se conservan; para los
-- demás, el expediente abierto prevalece sobre mora y mora sobre regularidad.

ALTER TABLE public.prestatarios
    DROP CONSTRAINT IF EXISTS prestatarios_estado_valido;

ALTER TABLE public.prestatarios
    ADD CONSTRAINT prestatarios_estado_valido
    CHECK (estado IN (
        'NUEVO', 'REGULAR', 'MOROSO', 'EXTRAJUDICIAL', 'BLOQUEADO', 'INACTIVO'
    ));

CREATE OR REPLACE FUNCTION public.sincronizar_estado_prestatario(
    p_prestatario_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_estado_actual TEXT;
    v_estado_nuevo TEXT;
    v_tiene_expediente BOOLEAN;
    v_tiene_mora BOOLEAN;
    v_tiene_historial BOOLEAN;
BEGIN
    SELECT estado INTO v_estado_actual
    FROM public.prestatarios
    WHERE id = p_prestatario_id
    FOR UPDATE;

    IF NOT FOUND THEN RETURN NULL; END IF;

    -- Estos estados se administran explícitamente y no deben ser sobrescritos
    -- por la operación de cartera.
    IF v_estado_actual IN ('BLOQUEADO', 'INACTIVO') THEN
        RETURN v_estado_actual;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.expedientes_extrajudicial x
        JOIN public.prestamos p ON p.id = x.prestamo_id
        WHERE p.prestatario_id = p_prestatario_id
          AND x.estado = 'ABIERTO'
    ) INTO v_tiene_expediente;

    SELECT EXISTS (
        SELECT 1
        FROM public.eventos_mora e
        JOIN public.prestamos p ON p.id = e.prestamo_id
        WHERE p.prestatario_id = p_prestatario_id
          AND e.fecha_fin IS NULL
    ) INTO v_tiene_mora;

    SELECT EXISTS (
        SELECT 1 FROM public.prestamos
        WHERE prestatario_id = p_prestatario_id
          AND estado <> 'ANULADO_SIN_DESEMBOLSO'
    ) INTO v_tiene_historial;

    v_estado_nuevo := CASE
        WHEN v_tiene_expediente THEN 'EXTRAJUDICIAL'
        WHEN v_tiene_mora THEN 'MOROSO'
        WHEN v_tiene_historial THEN 'REGULAR'
        ELSE 'NUEVO'
    END;

    IF v_estado_actual IS DISTINCT FROM v_estado_nuevo THEN
        UPDATE public.prestatarios SET estado = v_estado_nuevo
        WHERE id = p_prestatario_id;
    END IF;
    RETURN v_estado_nuevo;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sincronizar_estado_prestatario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prestatario_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'prestamos' THEN
        IF TG_OP = 'UPDATE' AND OLD.prestatario_id IS DISTINCT FROM NEW.prestatario_id THEN
            PERFORM public.sincronizar_estado_prestatario(OLD.prestatario_id);
        END IF;
        v_prestatario_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.prestatario_id ELSE NEW.prestatario_id END;
    ELSE
        SELECT prestatario_id INTO v_prestatario_id
        FROM public.prestamos
        WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.prestamo_id ELSE NEW.prestamo_id END;
    END IF;

    IF v_prestatario_id IS NOT NULL THEN
        PERFORM public.sincronizar_estado_prestatario(v_prestatario_id);
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prestamos_sincronizar_estado_cliente ON public.prestamos;
CREATE TRIGGER prestamos_sincronizar_estado_cliente
AFTER INSERT OR UPDATE OF estado, prestatario_id OR DELETE ON public.prestamos
FOR EACH ROW EXECUTE FUNCTION public.trg_sincronizar_estado_prestatario();

DROP TRIGGER IF EXISTS mora_sincronizar_estado_cliente ON public.eventos_mora;
CREATE TRIGGER mora_sincronizar_estado_cliente
AFTER INSERT OR UPDATE OF fecha_fin OR DELETE ON public.eventos_mora
FOR EACH ROW EXECUTE FUNCTION public.trg_sincronizar_estado_prestatario();

DROP TRIGGER IF EXISTS expedientes_sincronizar_estado_cliente ON public.expedientes_extrajudicial;
CREATE TRIGGER expedientes_sincronizar_estado_cliente
AFTER INSERT OR UPDATE OF estado OR DELETE ON public.expedientes_extrajudicial
FOR EACH ROW EXECUTE FUNCTION public.trg_sincronizar_estado_prestatario();

-- Alinea las fichas creadas antes de esta migración.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.prestatarios LOOP
        PERFORM public.sincronizar_estado_prestatario(r.id);
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_estado_prestatario(UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sincronizar_estado_prestatario()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_estado_prestatario(UUID) TO service_role;

COMMENT ON COLUMN public.prestatarios.estado IS
    'Estado operativo: NUEVO, REGULAR, MOROSO o EXTRAJUDICIAL; BLOQUEADO/INACTIVO se conservan por decisión administrativa.';
