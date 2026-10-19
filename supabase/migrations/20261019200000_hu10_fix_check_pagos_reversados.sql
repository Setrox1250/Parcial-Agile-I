-- HU-10: fix del check de HU-07 para permitir reversión compensatoria.
-- CA-29 / RN-33: la reversión conserva imputado_en (sin borrado destructivo)
-- pero pasa a estado 'REVERSADO'; el check original solo admitía 'CONFIRMADO'.
-- La vista cuotas_totales_imputados solo suma imputaciones de pagos
-- CONFIRMADO, por lo que al revertir quedan excluidas del abono de cuotas.

ALTER TABLE public.pagos
    DROP CONSTRAINT pagos_imputado_es_confirmado;

ALTER TABLE public.pagos
    ADD CONSTRAINT pagos_imputado_es_confirmado
    CHECK (imputado_en IS NULL OR estado IN ('CONFIRMADO', 'REVERSADO'));

COMMENT ON CONSTRAINT pagos_imputado_es_confirmado ON public.pagos IS
    'HU-07/HU-10 (RN-33): imputado_en exige CONFIRMADO; REVERSADO lo conserva como trazabilidad de la imputación original.';

-- ---------------------------------------------------------------------------
-- Metadatos de auditoría: en tablas sin columna `monto` (p. ej. prestamos),
-- registrar el principal como monto para trazabilidad CA-28.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_auditoria()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_nuevo JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
    v_anterior JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
    v_id UUID;
    v_prestamo UUID;
    v_actor UUID;
    v_sucursal UUID;
    v_rol TEXT := 'SISTEMA';
    v_accion TEXT;
BEGIN
    v_id := COALESCE((v_nuevo->>'id')::uuid, (v_anterior->>'id')::uuid);
    v_prestamo := COALESCE((v_nuevo->>'prestamo_id')::uuid, (v_anterior->>'prestamo_id')::uuid, CASE WHEN TG_TABLE_NAME = 'prestamos' THEN v_id END);
    v_actor := COALESCE((v_nuevo->>'confirma')::uuid, (v_nuevo->>'registra')::uuid, (v_nuevo->>'confirmo')::uuid, (v_nuevo->>'creado_por')::uuid,
                         (v_anterior->>'confirma')::uuid, (v_anterior->>'registra')::uuid, (v_anterior->>'confirmo')::uuid, (v_anterior->>'creado_por')::uuid);
    v_sucursal := COALESCE((v_nuevo->>'sucursal_id')::uuid, (v_anterior->>'sucursal_id')::uuid);
    IF v_sucursal IS NULL AND v_prestamo IS NOT NULL THEN SELECT sucursal_id INTO v_sucursal FROM public.prestamos WHERE id = v_prestamo; END IF;
    IF v_actor IS NOT NULL THEN SELECT rol INTO v_rol FROM public.perfiles WHERE auth_user_id = v_actor; v_rol := COALESCE(v_rol, 'USUARIO_ELIMINADO'); END IF;
    v_accion := CASE WHEN TG_OP = 'INSERT' THEN 'CREAR' WHEN TG_TABLE_NAME = 'pagos' AND v_nuevo->>'estado' = 'REVERSADO' THEN 'REVERSAR' ELSE 'ACTUALIZAR' END;
    INSERT INTO public.auditoria (actor, rol, sucursal_id, accion, entidad, entidad_id, correlacion, metadatos)
    VALUES (v_actor, v_rol, v_sucursal, v_accion, TG_TABLE_NAME, v_id,
      COALESCE(v_nuevo->>'idempotency_key', v_anterior->>'idempotency_key'),
      jsonb_strip_nulls(jsonb_build_object('prestamo_id', v_prestamo, 'estado_antes', v_anterior->>'estado', 'estado_despues', v_nuevo->>'estado', 'monto', COALESCE(v_nuevo->>'monto', v_anterior->>'monto', v_nuevo->>'principal', v_anterior->>'principal'))));
    RETURN COALESCE(NEW, OLD);
END; $$;

COMMENT ON FUNCTION public.registrar_auditoria() IS
    'HU-10: trigger de bitácora (CA-28). Extrae solo actor/rol/sucursal/estado/monto; sin PII (RN-34).';
