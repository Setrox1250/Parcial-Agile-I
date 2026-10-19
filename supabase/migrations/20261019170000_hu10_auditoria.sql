-- HU-10: bitácora inmutable y corrección compensatoria de pagos.
-- CA-28..CA-30, RN-31, RN-33 y RN-34.

CREATE TABLE public.auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor UUID,
    rol TEXT NOT NULL DEFAULT 'SISTEMA',
    sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE SET NULL,
    accion TEXT NOT NULL CHECK (accion IN ('CREAR', 'ACTUALIZAR', 'REVERSAR', 'SISTEMA')),
    entidad TEXT NOT NULL,
    entidad_id UUID,
    correlacion TEXT,
    metadatos JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_auditoria_fecha ON public.auditoria (fecha DESC);
CREATE INDEX idx_auditoria_entidad ON public.auditoria (entidad, entidad_id);
CREATE INDEX idx_auditoria_actor ON public.auditoria (actor, fecha DESC);
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria FROM anon, authenticated;

-- No se almacenan DNI, RUC, nombres, referencias ni payloads completos.
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
      jsonb_strip_nulls(jsonb_build_object('prestamo_id', v_prestamo, 'estado_antes', v_anterior->>'estado', 'estado_despues', v_nuevo->>'estado', 'monto', COALESCE(v_nuevo->>'monto', v_anterior->>'monto'))));
    RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION public.bloquear_mutacion_auditoria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDITORIA_INMUTABLE'; END; $$;
CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON public.auditoria FOR EACH ROW EXECUTE FUNCTION public.bloquear_mutacion_auditoria();

CREATE TRIGGER trg_audit_prestamos AFTER INSERT OR UPDATE ON public.prestamos FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE TRIGGER trg_audit_desembolsos AFTER INSERT OR UPDATE ON public.desembolsos FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE TRIGGER trg_audit_pagos AFTER INSERT OR UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE TRIGGER trg_audit_imputaciones AFTER INSERT ON public.pagos_imputaciones FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE TRIGGER trg_audit_mora AFTER INSERT OR UPDATE ON public.eventos_mora FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE TRIGGER trg_audit_expedientes AFTER INSERT OR UPDATE ON public.expedientes_extrajudicial FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE TABLE public.pagos_reversiones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pago_id UUID NOT NULL UNIQUE REFERENCES public.pagos(id) ON DELETE RESTRICT,
    motivo TEXT NOT NULL CHECK (length(trim(motivo)) >= 5),
    reversado_por UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    reversado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pagos_reversiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pagos_reversiones FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.revertir_pago_confirmado(p_pago_id UUID, p_motivo TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_pago public.pagos%ROWTYPE; v_capital NUMERIC(12,2); v_existente UUID;
BEGIN
    SELECT * INTO v_pago FROM public.pagos WHERE id = p_pago_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'PAGO_INEXISTENTE'); END IF;
    SELECT id INTO v_existente FROM public.pagos_reversiones WHERE pago_id = p_pago_id;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotente', true, 'reversion_id', v_existente); END IF;
    IF v_pago.estado <> 'CONFIRMADO' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'PAGO_NO_CONFIRMADO'); END IF;
    IF p_actor IS NULL OR p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'REVERSO_INVALIDO'); END IF;
    SELECT COALESCE(SUM(importe_capital), 0) INTO v_capital FROM public.pagos_imputaciones WHERE pago_id = p_pago_id;
    INSERT INTO public.pagos_reversiones (pago_id, motivo, reversado_por) VALUES (p_pago_id, trim(p_motivo), p_actor) RETURNING id INTO v_existente;
    UPDATE public.pagos SET estado = 'REVERSADO', confirma = p_actor, confirmado_en = now() WHERE id = p_pago_id;
    UPDATE public.cuotas c SET estado = CASE WHEN COALESCE(t.total_abonado,0) <= .005 THEN 'PENDIENTE' WHEN COALESCE(t.total_abonado,0) >= c.total_programado - .005 THEN 'PAGADA' ELSE 'PARCIAL' END, actualizado_en = now()
    FROM (SELECT c2.id, COALESCE(v.total_abonado,0) total_abonado FROM public.cuotas c2 LEFT JOIN public.cuotas_totales_imputados v ON v.cuota_id=c2.id WHERE c2.prestamo_id=v_pago.prestamo_id) t WHERE c.id=t.id;
    UPDATE public.prestamos SET estado = CASE WHEN estado='PAGADO' THEN 'ACTIVO' ELSE estado END, capital_insoluto = LEAST(principal, capital_insoluto + v_capital), actualizado_en=now() WHERE id=v_pago.prestamo_id;
    PERFORM public.sincronizar_mora_prestamo(v_pago.prestamo_id);
    RETURN jsonb_build_object('ok', true, 'idempotente', false, 'reversion_id', v_existente);
END; $$;
REVOKE ALL ON FUNCTION public.revertir_pago_confirmado(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_pago_confirmado(UUID, TEXT, UUID) TO service_role;
