-- Permite corregir términos y cronograma únicamente antes del desembolso.
-- La TEA permanece fija en 30 % y la reserva de cupo se actualiza en la misma transacción.
CREATE OR REPLACE FUNCTION public.editar_prestamo_pendiente(
    p_prestamo_id UUID,
    p_monto NUMERIC(12,2),
    p_plazo_meses INTEGER,
    p_cuotas JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prestamo public.prestamos%ROWTYPE;
    v_prestatario_id UUID;
    v_ocupado NUMERIC(12,2);
    v_limite CONSTANT NUMERIC(12,2) := 10000.00;
    v_bloqueos JSONB;
    v_suma_capital NUMERIC(12,2);
BEGIN
    SELECT prestatario_id INTO v_prestatario_id
    FROM public.prestamos WHERE id = p_prestamo_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'PRESTAMO_INEXISTENTE');
    END IF;

    -- Serializa cambios de cupo del prestatario igual que la originación.
    PERFORM 1 FROM public.prestatarios WHERE id = v_prestatario_id FOR UPDATE;
    SELECT * INTO v_prestamo FROM public.prestamos WHERE id = p_prestamo_id FOR UPDATE;
    IF v_prestamo.estado <> 'PENDIENTE_DESEMBOLSO' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'ESTADO_NO_EDITABLE', 'estado', v_prestamo.estado);
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 OR p_plazo_meses IS NULL OR p_plazo_meses NOT BETWEEN 1 AND 60 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'TERMINOS_INVALIDOS');
    END IF;
    IF p_cuotas IS NULL OR jsonb_typeof(p_cuotas) <> 'array'
       OR jsonb_array_length(p_cuotas) <> p_plazo_meses THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'CRONOGRAMA_INVALIDO');
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_cuotas) WITH ORDINALITY t(c, ord)
        WHERE (c->>'numero') IS NULL OR (c->>'numero')::integer <> t.ord
           OR (c->>'vencimiento') IS NULL OR (c->>'vencimiento')::date <= v_prestamo.fecha_originacion
           OR (c->>'capital') IS NULL OR (c->>'capital')::numeric < 0
           OR (c->>'interes') IS NULL OR (c->>'interes')::numeric < 0
           OR (c->>'total') IS NULL
           OR (c->>'total')::numeric <> (c->>'capital')::numeric + (c->>'interes')::numeric
    ) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'CRONOGRAMA_INVALIDO');
    END IF;
    SELECT COALESCE(SUM((c->>'capital')::numeric), 0) INTO v_suma_capital
    FROM jsonb_array_elements(p_cuotas) c;
    IF ABS(v_suma_capital - p_monto) > 0.01 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'CRONOGRAMA_INVALIDO');
    END IF;

    SELECT COALESCE(jsonb_agg(elementos.valor), '[]'::jsonb) INTO v_bloqueos
    FROM jsonb_array_elements(public.evaluar_elegibilidad(v_prestatario_id, NULL)->'bloqueos') AS elementos(valor);
    IF jsonb_array_length(v_bloqueos) > 0 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'PRESTATARIO_BLOQUEADO', 'bloqueos', v_bloqueos);
    END IF;
    SELECT COALESCE(SUM(capital_insoluto) FILTER (WHERE estado = 'ACTIVO'), 0)
         + COALESCE(SUM(reserva_capital) FILTER (WHERE estado = 'PENDIENTE_DESEMBOLSO' AND id <> p_prestamo_id), 0)
      INTO v_ocupado
      FROM public.prestamos WHERE prestatario_id = v_prestatario_id;
    IF v_ocupado + p_monto > v_limite THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'CUPO_INSUFICIENTE', 'disponible', GREATEST(0, v_limite - v_ocupado));
    END IF;

    UPDATE public.prestamos
       SET principal = p_monto, reserva_capital = p_monto, plazo_meses = p_plazo_meses,
           actualizado_en = now()
     WHERE id = p_prestamo_id;
    DELETE FROM public.cuotas WHERE prestamo_id = p_prestamo_id;
    INSERT INTO public.cuotas (prestamo_id, numero, vencimiento, capital_programado, interes_programado, total_programado)
    SELECT p_prestamo_id, (c->>'numero')::integer, (c->>'vencimiento')::date,
           (c->>'capital')::numeric, (c->>'interes')::numeric, (c->>'total')::numeric
      FROM jsonb_array_elements(p_cuotas) c;
    RETURN jsonb_build_object('ok', true, 'motivo', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.editar_prestamo_pendiente(UUID, NUMERIC, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_prestamo_pendiente(UUID, NUMERIC, INTEGER, JSONB) TO service_role;
