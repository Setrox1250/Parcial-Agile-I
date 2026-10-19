-- HU-04: funciones de exposición, elegibilidad y reserva atómica de cupo.
-- RN-09..RN-15 y §4.1 (cupo y capital amortizado); RN-32/CP-16 (serialización
-- por sucursal concurrente mediante FOR UPDATE de la fila del prestatario).
-- SECURITY DEFINER: el cliente no ejecuta nada; las invoca Edge Functions con
-- service_role (REVOKE abajo) o el motor de pruebas con postgres.

-- ---------------------------------------------------------------------------
-- 1) Exposición global del prestatario en todas las sucursales (RN-09).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_exposicion(p_prestatario_id UUID)
RETURNS NUMERIC(12,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(SUM(p.capital_insoluto) FILTER (WHERE p.estado = 'ACTIVO'), 0)
         + COALESCE(SUM(p.reserva_capital) FILTER (WHERE p.estado = 'PENDIENTE_DESEMBOLSO'), 0)
    FROM public.prestamos p
    WHERE p.prestatario_id = p_prestatario_id;
$$;

COMMENT ON FUNCTION public.calcular_exposicion(UUID) IS
    'RN-09: suma capital_insoluto ACTIVO + reserva_capital PENDIENTE_DESEMBOLSO por prestatario.';

-- ---------------------------------------------------------------------------
-- 2) Elegibilidad y cupo (§4.1, CA-26). Reporte sin efectos secundarios.
-- ---------------------------------------------------------------------------
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
            'prestatario_id', p_prestatario_id,
            'existe', false,
            'clasificacion', NULL,
            'bloqueos', '[]'::jsonb,
            'limite', v_limite,
            'ocupado', 0,
            'disponible', 0,
            'monto_solicitado', p_monto,
            'elegible', false,
            'motivo', 'PRESTATARIO_INEXISTENTE'
        );
    END IF;

    v_ocupado := public.calcular_exposicion(p_prestatario_id);
    v_disponible := GREATEST(0, v_limite - v_ocupado);

    -- B-05 ratificado: NUEVO sin historial; REGULAR con >= 1 préstamo no anulado.
    SELECT COUNT(*) INTO v_historial
    FROM public.prestamos
    WHERE prestatario_id = p_prestatario_id
      AND estado <> 'ANULADO_SIN_DESEMBOLSO';

    v_clasificacion := CASE WHEN v_historial = 0 THEN 'NUEVO' ELSE 'REGULAR' END;

    -- Restricciones independientes de cupo (RN-05, RN-15, §5 elegibilidad).
    SELECT COUNT(*) INTO v_incidencias
    FROM public.prestatario_incidencias
    WHERE prestatario_id = p_prestatario_id
      AND estado = 'PENDIENTE';

    SELECT COUNT(*) INTO v_mora_abierta
    FROM public.eventos_mora e
    JOIN public.prestamos pr ON pr.id = e.prestamo_id
    WHERE pr.prestatario_id = p_prestatario_id
      AND e.fecha_fin IS NULL;

    SELECT COUNT(*) INTO v_extrajudicial
    FROM public.expdedientes_extrajudicial x
    JOIN public.prestamos pr ON pr.id = x.prestamo_id
    WHERE pr.prestatario_id = p_prestatario_id
      AND x.estado = 'ABIERTO';

    -- array_append explícito: en plpgsql "texto[] || 'lit'" resuelve a
    -- texto[] || texto[] y falla al castear el literal.
    IF v_incidencias > 0 THEN
        v_bloqueos := array_append(v_bloqueos, 'BLOQUEADO_INCIDENCIA_IDENTIDAD');
    END IF;
    IF v_mora_abierta > 0 THEN
        v_bloqueos := array_append(v_bloqueos, 'MOROSO');
    END IF;
    IF v_extrajudicial > 0 THEN
        v_bloqueos := array_append(v_bloqueos, 'EXTRAJUDICIAL');
    END IF;

    -- Motivo principal: bloqueos primero; luego monto y cupo (§4.1).
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
        'prestatario_id', p_prestatario_id,
        'existe', true,
        'clasificacion', v_clasificacion,
        'bloqueos', to_jsonb(v_bloqueos),
        'limite', v_limite,
        'ocupado', v_ocupado,
        'disponible', v_disponible,
        'monto_solicitado', p_monto,
        'elegible', v_motivo IS NULL,
        'motivo', v_motivo
    );
END;
$$;

COMMENT ON FUNCTION public.evaluar_elegibilidad(UUID, NUMERIC) IS
    '§4.1: clasificación NUEVO/REGULAR, bloqueos (incidencia RN-05, MOROSO, EXTRAJUDICIAL) y cupo. p_monto NULL = reporte de cupo.';

-- ---------------------------------------------------------------------------
-- 3) Reserva atómica e idempotente de cupo al crear el préstamo (CA-15).
--    HU-05/HU-06 la usan dentro de su transacción de originación/desembolso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservar_cupo(
    p_prestatario_id UUID,
    p_monto NUMERIC(12,2),
    p_plazo_meses INTEGER,
    p_sucursal_id UUID,
    p_creado_por UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existente UUID;
    v_eval JSONB;
    v_prestamo_id UUID;
BEGIN
    -- RN-31: misma idempotency_key devuelve la reserva ya creada (CA-15).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existente
        FROM public.prestamos
        WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'ok', true, 'idempotente', true,
                'prestamo_id', v_existente, 'motivo', NULL
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

    -- RN-32/CP-16: serializa todas las originaciones del mismo prestatario
    -- (cualquier sede) bloqueando su fila maestra; sin filas no hay bloqueo.
    PERFORM 1 FROM public.prestatarios WHERE id = p_prestatario_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL, 'motivo', 'PRESTATARIO_INEXISTENTE'
        );
    END IF;

    v_eval := public.evaluar_elegibilidad(p_prestatario_id, p_monto);
    IF NOT (v_eval->>'elegible')::boolean THEN
        RETURN jsonb_build_object(
            'ok', false, 'idempotente', false,
            'prestamo_id', NULL,
            'motivo', v_eval->>'motivo',
            'bloqueos', v_eval->'bloqueos',
            'clasificacion', v_eval->'clasificacion',
            'ocupado', (v_eval->>'ocupado')::numeric,
            'disponible', (v_eval->>'disponible')::numeric
        );
    END IF;

    BEGIN
        INSERT INTO public.prestamos (
            prestatario_id, sucursal_id, creado_por,
            principal, capital_insoluto, reserva_capital,
            tea, plazo_meses, estado, idempotency_key
        ) VALUES (
            p_prestatario_id, p_sucursal_id, p_creado_por,
            p_monto, 0, p_monto,
            0.30, p_plazo_meses, 'PENDIENTE_DESEMBOLSO', p_idempotency_key
        )
        RETURNING id INTO v_prestamo_id;
    EXCEPTION WHEN unique_violation THEN
        -- Carrera con la misma idempotency_key: se resuelve devolviendo la existente.
        SELECT id INTO v_existente
        FROM public.prestamos
        WHERE idempotency_key = p_idempotency_key;
        RETURN jsonb_build_object(
            'ok', true, 'idempotente', true,
            'prestamo_id', v_existente, 'motivo', NULL
        );
    END;

    v_eval := public.evaluar_elegibilidad(p_prestatario_id, NULL);
    RETURN jsonb_build_object(
        'ok', true, 'idempotente', false,
        'prestamo_id', v_prestamo_id, 'motivo', NULL,
        'clasificacion', v_eval->'clasificacion',
        'ocupado', (v_eval->>'ocupado')::numeric,
        'disponible', (v_eval->>'disponible')::numeric
    );
END;
$$;

COMMENT ON FUNCTION public.reservar_cupo(UUID, NUMERIC, INTEGER, UUID, UUID, TEXT) IS
    'CA-15/RN-31/RN-32: crea préstamo PENDIENTE_DESEMBOLSO con reserva=principal bajo FOR UPDATE del prestatario; idempotente por p_idempotency_key.';

-- ---------------------------------------------------------------------------
-- 4) Liberación de reserva (anulación antes de desembolso, CA-17).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liberar_reserva(p_prestamo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_estado TEXT;
BEGIN
    SELECT estado INTO v_estado
    FROM public.prestamos
    WHERE id = p_prestamo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', false, 'estado', NULL, 'motivo', 'PRESTAMO_INEXISTENTE'
        );
    END IF;

    IF v_estado <> 'PENDIENTE_DESEMBOLSO' THEN
        RETURN jsonb_build_object(
            'ok', false, 'estado', v_estado, 'motivo', 'ESTADO_NO_RESERVADO'
        );
    END IF;

    UPDATE public.prestamos
    SET estado = 'ANULADO_SIN_DESEMBOLSO',
        reserva_capital = 0,
        actualizado_en = now()
    WHERE id = p_prestamo_id;

    RETURN jsonb_build_object(
        'ok', true, 'estado', 'ANULADO_SIN_DESEMBOLSO', 'motivo', NULL
    );
END;
$$;

COMMENT ON FUNCTION public.liberar_reserva(UUID) IS
    'CA-17: anula un préstamo PENDIENTE_DESEMBOLSO liberando la reserva de cupo; otros estados se rechazan.';

-- ---------------------------------------------------------------------------
-- Privilegios: solo service_role (Edge Functions); nada para el cliente (RN-34/CA-30).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.calcular_exposicion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluar_elegibilidad(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reservar_cupo(UUID, NUMERIC, INTEGER, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.liberar_reserva(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.calcular_exposicion(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluar_elegibilidad(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.reservar_cupo(UUID, NUMERIC, INTEGER, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_reserva(UUID) TO service_role;
