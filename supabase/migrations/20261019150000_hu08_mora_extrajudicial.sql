-- HU-08: detección de mora, rachas y escalamiento extrajudicial.
-- RN-15, RN-26..RN-29, RN-31, RN-37, RN-38; CA-22..CA-24.
-- La fecha de negocio siempre se calcula en America/Lima; no se persiste
-- "VENCIDA" en cuotas porque es una condición derivada de fecha + saldo.

-- La tabla inicial contenía un error ortográfico. Se corrige sin reescribir
-- la migración ya aplicada ni perder datos existentes.
ALTER TABLE IF EXISTS public.expdedientes_extrajudicial
    RENAME TO expedientes_extrajudicial;

COMMENT ON TABLE public.expedientes_extrajudicial IS
    'HU-08: expediente de cobranza EXTRAJUDICIAL por racha de mora. El historial no se borra ni sustituye la deuda (RN-27/RN-28).';

-- `evaluar_elegibilidad` se vuelve a declarar porque PL/pgSQL conserva el
-- nombre de relación en su cuerpo y ahora debe consultar la tabla corregida.
CREATE OR REPLACE FUNCTION public.evaluar_elegibilidad(
    p_prestatario_id UUID,
    p_monto NUMERIC(12,2) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_limite CONSTANT NUMERIC(12,2) := 10000.00;
    v_existe BOOLEAN;
    v_estado_auditado TEXT;
    v_ocupado NUMERIC(12,2);
    v_disponible NUMERIC(12,2);
    v_historial BIGINT;
    v_incidencias BIGINT;
    v_mora_abierta BIGINT;
    v_extrajudicial BIGINT;
    v_bloqueos TEXT[] := '{}';
    v_clasificacion TEXT := NULL;
    v_motivo TEXT := NULL;
BEGIN
    IF p_prestatario_id IS NOT NULL THEN
        SELECT EXISTS (SELECT 1 FROM public.prestatarios WHERE id = p_prestatario_id)
        INTO v_existe;
    ELSE
        v_existe := false;
    END IF;

    IF v_existe IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'prestatario_id', p_prestatario_id, 'existe', false,
            'clasificacion', NULL, 'bloqueos', '[]'::jsonb,
            'limite', v_limite, 'ocupado', 0, 'disponible', 0,
            'monto_solicitado', p_monto, 'elegible', false,
            'motivo', 'PRESTATARIO_INEXISTENTE'
        );
    END IF;

    v_ocupado := public.calcular_exposicion(p_prestatario_id);
    v_disponible := GREATEST(0, v_limite - v_ocupado);

    SELECT estado INTO v_estado_auditado
    FROM public.prestatarios WHERE id = p_prestatario_id;

    SELECT COUNT(*) INTO v_historial
    FROM public.prestamos
    WHERE prestatario_id = p_prestatario_id
      AND estado <> 'ANULADO_SIN_DESEMBOLSO';
    v_clasificacion := CASE WHEN v_historial = 0 THEN 'NUEVO' ELSE 'REGULAR' END;

    SELECT COUNT(*) INTO v_incidencias
    FROM public.prestatario_incidencias
    WHERE prestatario_id = p_prestatario_id AND estado = 'PENDIENTE';

    SELECT COUNT(*) INTO v_mora_abierta
    FROM public.eventos_mora e
    JOIN public.prestamos pr ON pr.id = e.prestamo_id
    WHERE pr.prestatario_id = p_prestatario_id AND e.fecha_fin IS NULL;

    SELECT COUNT(*) INTO v_extrajudicial
    FROM public.expedientes_extrajudicial x
    JOIN public.prestamos pr ON pr.id = x.prestamo_id
    WHERE pr.prestatario_id = p_prestatario_id AND x.estado = 'ABIERTO';

    IF v_incidencias > 0 THEN
        v_bloqueos := array_append(v_bloqueos, 'BLOQUEADO_INCIDENCIA_IDENTIDAD');
    END IF;
    IF v_estado_auditado IN ('BLOQUEADO', 'INACTIVO') THEN
        v_bloqueos := array_append(v_bloqueos, 'BLOQUEADO_AUDITADO');
    END IF;
    IF v_mora_abierta > 0 THEN
        v_bloqueos := array_append(v_bloqueos, 'MOROSO');
    END IF;
    IF v_extrajudicial > 0 THEN
        v_bloqueos := array_append(v_bloqueos, 'EXTRAJUDICIAL');
    END IF;

    IF cardinality(v_bloqueos) > 0 THEN
        v_motivo := v_bloqueos[1];
    ELSIF p_monto IS NOT NULL AND p_monto <= 0 THEN
        v_motivo := 'MONTO_INVALIDO';
    ELSIF p_monto IS NOT NULL AND p_monto > v_disponible THEN
        v_motivo := 'CUPO_INSUFICIENTE';
    ELSIF p_monto IS NULL AND v_disponible < 0.01 THEN
        v_motivo := 'CUPO_INSUFICIENTE';
    END IF;

    RETURN jsonb_build_object(
        'prestatario_id', p_prestatario_id, 'existe', true,
        'clasificacion', v_clasificacion, 'bloqueos', to_jsonb(v_bloqueos),
        'limite', v_limite, 'ocupado', v_ocupado, 'disponible', v_disponible,
        'monto_solicitado', p_monto, 'elegible', v_motivo IS NULL,
        'motivo', v_motivo
    );
END;
$$;

-- Sincroniza una racha para un préstamo. También la invoca el trigger de
-- imputación, así el desbloqueo por pago no espera hasta el siguiente cron.
CREATE OR REPLACE FUNCTION public.sincronizar_mora_prestamo(
    p_prestamo_id UUID,
    p_fecha DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fecha DATE := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Lima')::date);
    v_estado TEXT;
    v_inicio DATE;
    v_monto NUMERIC(12,2);
    v_evidencia JSONB;
    v_evento public.eventos_mora%ROWTYPE;
    v_evento_existia BOOLEAN := false;
    v_expediente_creado BOOLEAN := false;
    v_filas INTEGER;
BEGIN
    SELECT estado INTO v_estado
    FROM public.prestamos
    WHERE id = p_prestamo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'PRESTAMO_INEXISTENTE');
    END IF;

    -- Una cuota queda vencida solo desde el día posterior a su vencimiento.
    SELECT
        MIN(c.vencimiento) + 1,
        ROUND(COALESCE(SUM(c.total_programado - COALESCE(t.total_abonado, 0)), 0), 2),
        COALESCE(jsonb_agg(jsonb_build_object(
            'cuota_id', c.id,
            'numero', c.numero,
            'vencimiento', to_char(c.vencimiento, 'YYYY-MM-DD'),
            'saldo', c.total_programado - COALESCE(t.total_abonado, 0)
        ) ORDER BY c.numero), '[]'::jsonb)
    INTO v_inicio, v_monto, v_evidencia
    FROM public.cuotas c
    LEFT JOIN public.cuotas_totales_imputados t ON t.cuota_id = c.id
    WHERE c.prestamo_id = p_prestamo_id
      AND v_estado = 'ACTIVO'
      AND c.vencimiento < v_fecha
      AND c.total_programado - COALESCE(t.total_abonado, 0) > 0.005;

    SELECT * INTO v_evento
    FROM public.eventos_mora
    WHERE prestamo_id = p_prestamo_id AND fecha_fin IS NULL
    FOR UPDATE;
    v_evento_existia := FOUND;

    IF v_inicio IS NULL THEN
        IF v_evento_existia THEN
            UPDATE public.eventos_mora
            SET fecha_fin = v_fecha
            WHERE id = v_evento.id;
            RETURN jsonb_build_object(
                'ok', true, 'accion', 'CERRADA', 'evento_mora_id', v_evento.id,
                'expediente_creado', false
            );
        END IF;
        RETURN jsonb_build_object('ok', true, 'accion', 'SIN_MORA', 'expediente_creado', false);
    END IF;

    IF NOT v_evento_existia THEN
        INSERT INTO public.eventos_mora (prestamo_id, inicio_mora, monto_vencido, evidencia)
        VALUES (p_prestamo_id, v_inicio, v_monto, v_evidencia)
        RETURNING * INTO v_evento;
    ELSE
        -- El inicio nunca se desplaza: identifica la racha continua original.
        UPDATE public.eventos_mora
        SET monto_vencido = v_monto, evidencia = v_evidencia
        WHERE id = v_evento.id
        RETURNING * INTO v_evento;
    END IF;

    IF v_fecha >= (v_evento.inicio_mora + INTERVAL '1 year')::date THEN
        INSERT INTO public.expedientes_extrajudicial (
            prestamo_id, evento_mora_id, fecha_escalamiento, estado
        ) VALUES (
            p_prestamo_id, v_evento.id,
            (v_evento.inicio_mora + INTERVAL '1 year')::date, 'ABIERTO'
        ) ON CONFLICT (evento_mora_id) DO NOTHING;
        GET DIAGNOSTICS v_filas = ROW_COUNT;
        v_expediente_creado := v_filas > 0;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'accion', CASE WHEN v_evento_existia THEN 'ACTUALIZADA' ELSE 'ABIERTA' END,
        'evento_mora_id', v_evento.id,
        'inicio_mora', to_char(v_evento.inicio_mora, 'YYYY-MM-DD'),
        'monto_vencido', v_monto,
        'expediente_creado', v_expediente_creado
    );
END;
$$;

COMMENT ON FUNCTION public.sincronizar_mora_prestamo(UUID, DATE) IS
    'HU-08: abre o cierra la racha de mora según cuotas vencidas con saldo; escala una vez al aniversario anual (RN-26..RN-29).';

-- Recorre los préstamos activos y toda racha aún abierta. El advisory lock
-- hace idempotente y serializable una ejecución manual y la ejecución cron.
CREATE OR REPLACE FUNCTION public.procesar_mora(p_fecha DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fecha DATE := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Lima')::date);
    r RECORD;
    v_resultado JSONB;
    v_abiertas INTEGER := 0;
    v_actualizadas INTEGER := 0;
    v_cerradas INTEGER := 0;
    v_expedientes INTEGER := 0;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.procesar_mora'));

    FOR r IN
        SELECT id FROM public.prestamos WHERE estado = 'ACTIVO'
        UNION
        SELECT prestamo_id FROM public.eventos_mora WHERE fecha_fin IS NULL
    LOOP
        v_resultado := public.sincronizar_mora_prestamo(r.id, v_fecha);
        CASE v_resultado->>'accion'
            WHEN 'ABIERTA' THEN v_abiertas := v_abiertas + 1;
            WHEN 'ACTUALIZADA' THEN v_actualizadas := v_actualizadas + 1;
            WHEN 'CERRADA' THEN v_cerradas := v_cerradas + 1;
            ELSE NULL;
        END CASE;
        IF COALESCE((v_resultado->>'expediente_creado')::boolean, false) THEN
            v_expedientes := v_expedientes + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true, 'fecha', to_char(v_fecha, 'YYYY-MM-DD'),
        'moras_abiertas', v_abiertas, 'moras_actualizadas', v_actualizadas,
        'moras_cerradas', v_cerradas, 'expedientes_creados', v_expedientes
    );
END;
$$;

COMMENT ON FUNCTION public.procesar_mora(DATE) IS
    'HU-08: proceso diario idempotente de mora en America/Lima. No añade intereses ni penalidades (RN-37/RN-38).';

-- Pago confirmado e imputado: recalcula inmediatamente el préstamo afectado.
CREATE OR REPLACE FUNCTION public.sincronizar_mora_al_imputar_pago()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.imputado_en IS NULL AND NEW.imputado_en IS NOT NULL THEN
        PERFORM public.sincronizar_mora_prestamo(NEW.prestamo_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagos_sincronizar_mora ON public.pagos;
CREATE TRIGGER trg_pagos_sincronizar_mora
AFTER UPDATE OF imputado_en ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_mora_al_imputar_pago();

REVOKE ALL ON FUNCTION public.sincronizar_mora_prestamo(UUID, DATE)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.procesar_mora(DATE)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sincronizar_mora_al_imputar_pago()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_mora_prestamo(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.procesar_mora(DATE) TO service_role;
REVOKE ALL ON public.expedientes_extrajudicial FROM anon, authenticated;

-- Supabase Cron ejecuta SQL dentro de PostgreSQL. 05:05 UTC equivale a
-- 00:05 America/Lima (Perú no aplica DST); la función vuelve a fijar la
-- zona de negocio para no depender de la zona del scheduler.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
    'procesar-mora-diaria-lima',
    '5 5 * * *',
    $$SELECT public.procesar_mora();$$
);
