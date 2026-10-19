-- HU-03 / CA-08: acreditación manual y trazable de facultades de representación.
-- ADMIN y SUPERVISOR_FINANCIERO pueden ejecutar la operación desde la Edge
-- Function; la BD exige que la persona ya exista como DNI validado (HU-02).

ALTER TABLE public.representantes_empresa
    ADD COLUMN IF NOT EXISTS evidencia_referencia TEXT;

ALTER TABLE public.representantes_empresa
    DROP CONSTRAINT IF EXISTS representantes_autorizacion_con_fuente;

ALTER TABLE public.representantes_empresa
    ADD CONSTRAINT representantes_autorizacion_con_evidencia
    CHECK (
        autorizacion_comprobada = FALSE
        OR (
            fuente IS NOT NULL AND length(trim(fuente)) >= 3
            AND comprobado_en IS NOT NULL
            AND evidencia_referencia IS NOT NULL
            AND length(trim(evidencia_referencia)) >= 5
        )
    ) NOT VALID;

COMMENT ON COLUMN public.representantes_empresa.evidencia_referencia IS
    'Referencia de la evidencia de facultades (p. ej., partida/asiento/acta). No almacenar el documento ni PII adicional.';

CREATE OR REPLACE FUNCTION public.acreditar_representacion_empresa(
    p_empresa_id UUID,
    p_representante_dni CHAR(8),
    p_fuente TEXT,
    p_evidencia_referencia TEXT,
    p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tipo TEXT;
    v_persona_id UUID;
    v_representante_id UUID;
    v_ya_comprobada BOOLEAN;
    v_rol TEXT;
    v_sucursal_id UUID;
BEGIN
    IF p_empresa_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'EMPRESA_INEXISTENTE');
    END IF;
    IF p_representante_dni IS NULL OR p_representante_dni !~ '^[0-9]{8}$' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'DNI_INVALIDO');
    END IF;
    IF p_fuente IS NULL OR length(trim(p_fuente)) < 3 OR length(trim(p_fuente)) > 100
       OR p_evidencia_referencia IS NULL OR length(trim(p_evidencia_referencia)) < 5
       OR length(trim(p_evidencia_referencia)) > 500 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'EVIDENCIA_INVALIDA');
    END IF;

    -- Defensa en profundidad: la función privilegiada no acepta un actor
    -- inexistente/inactivo aunque alguien llegue a invocarla fuera de la EF.
    IF p_actor IS NOT NULL THEN
        SELECT rol, sucursal_id INTO v_rol, v_sucursal_id
        FROM public.perfiles
        WHERE auth_user_id = p_actor AND activo = TRUE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'motivo', 'ACTOR_INVALIDO');
        END IF;
    ELSE
        v_rol := 'SISTEMA';
    END IF;

    SELECT tipo INTO v_tipo
    FROM public.prestatarios
    WHERE id = p_empresa_id
    FOR UPDATE;
    IF NOT FOUND OR v_tipo <> 'EMPRESA' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'EMPRESA_INEXISTENTE');
    END IF;

    SELECT prestatario_id INTO v_persona_id
    FROM public.personas_naturales
    WHERE dni = p_representante_dni;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'DNI_NO_VALIDADO');
    END IF;

    SELECT id, autorizacion_comprobada
    INTO v_representante_id, v_ya_comprobada
    FROM public.representantes_empresa
    WHERE empresa_id = p_empresa_id AND persona_id = v_persona_id
    FOR UPDATE;

    IF FOUND AND v_ya_comprobada THEN
        RETURN jsonb_build_object(
            'ok', true, 'idempotente', true,
            'representante_id', v_representante_id, 'motivo', NULL
        );
    END IF;

    IF FOUND THEN
        UPDATE public.representantes_empresa
        SET autorizacion_comprobada = TRUE,
            fuente = trim(p_fuente),
            evidencia_referencia = trim(p_evidencia_referencia),
            comprobado_en = now(),
            comprobado_por = p_actor
        WHERE id = v_representante_id;
    ELSE
        INSERT INTO public.representantes_empresa (
            empresa_id, persona_id, rol, autorizacion_comprobada, fuente,
            evidencia_referencia, comprobado_en, comprobado_por
        ) VALUES (
            p_empresa_id, v_persona_id, 'REPRESENTANTE_LEGAL', TRUE,
            trim(p_fuente), trim(p_evidencia_referencia), now(), p_actor
        ) RETURNING id INTO v_representante_id;
    END IF;

    -- CA-28/RN-34: se registra actor y operación, pero nunca DNI ni la
    -- referencia documental completa en los metadatos de auditoría.
    INSERT INTO public.auditoria (
        actor, rol, sucursal_id, accion, entidad, entidad_id, metadatos
    ) VALUES (
        p_actor, v_rol, v_sucursal_id, 'ACTUALIZAR', 'representantes_empresa',
        v_representante_id,
        jsonb_build_object('empresa_id', p_empresa_id, 'facultades_comprobadas', TRUE)
    );

    RETURN jsonb_build_object(
        'ok', true, 'idempotente', false,
        'representante_id', v_representante_id, 'motivo', NULL
    );
END;
$$;

COMMENT ON FUNCTION public.acreditar_representacion_empresa(UUID, CHAR, TEXT, TEXT, UUID) IS
    'HU-03/CA-08: acredita, con evidencia y actor, la representación de una persona DNI validada para una empresa.';

REVOKE ALL ON FUNCTION public.acreditar_representacion_empresa(UUID, CHAR, TEXT, TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acreditar_representacion_empresa(UUID, CHAR, TEXT, TEXT, UUID)
    TO service_role;
