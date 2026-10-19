-- HU-03 / CA-08: una empresa solo puede recibir crédito cuando existe una
-- persona natural previamente verificada y con facultades comprobadas.
--
-- La interfaz ya advierte que un RUC ACTIVO/HABIDO no acredita poderes, pero
-- este control debe vivir en la autoridad de elegibilidad para que una llamada
-- directa a la Edge Function de préstamos tampoco pueda crear una reserva.

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
    v_tipo TEXT;
    v_estado_auditado TEXT;
    v_representacion_comprobada BOOLEAN := false;
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

    SELECT tipo, estado INTO v_tipo, v_estado_auditado
    FROM public.prestatarios
    WHERE id = p_prestatario_id;

    -- CA-08: el vínculo debe apuntar a una persona natural validada por HU-02,
    -- y la autorización debe tener la evidencia registrada por el proceso
    -- aprobado. Tener RUC ACTIVO/HABIDO o solo un DNI vinculado no basta.
    IF v_tipo = 'EMPRESA' THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.empresas e
            JOIN public.representantes_empresa re
              ON re.empresa_id = e.prestatario_id
            JOIN public.personas_naturales pn
              ON pn.prestatario_id = re.persona_id
            WHERE e.prestatario_id = p_prestatario_id
              AND re.autorizacion_comprobada = TRUE
              AND re.fuente IS NOT NULL
              AND re.comprobado_en IS NOT NULL
              AND re.evidencia_referencia IS NOT NULL
              AND length(trim(re.evidencia_referencia)) >= 5
        ) INTO v_representacion_comprobada;
    END IF;

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

    IF v_tipo = 'EMPRESA' AND NOT v_representacion_comprobada THEN
        v_bloqueos := array_append(v_bloqueos, 'BLOQUEADO_REPRESENTACION_EMPRESA');
    END IF;
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

COMMENT ON FUNCTION public.evaluar_elegibilidad(UUID, NUMERIC) IS
    '§4.1 y HU-03/CA-08: cupo y bloqueos; una empresa requiere representante DNI validado y facultades comprobadas antes de originar.';
