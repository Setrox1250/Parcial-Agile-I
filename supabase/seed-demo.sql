-- Datos de demostración para validar los flujos principales del MVP.
--
-- Este archivo es intencionalmente independiente de las migraciones: se puede
-- ejecutar una vez sobre un proyecto ya migrado con el rol service_role o desde
-- el SQL Editor de Supabase. No borra datos existentes y usa identificadores
-- reservados para que las filas de demo sean fáciles de reconocer.
--
-- Requisitos: ejecutar después de todas las migraciones del repositorio.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Fichas de personas y empresas
-- ---------------------------------------------------------------------------
INSERT INTO public.prestatarios (id, tipo, estado)
VALUES
    ('10000000-0000-4000-8000-000000000001', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000002', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000003', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000004', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000005', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000006', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000007', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000008', 'PERSONA_NATURAL', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000009', 'EMPRESA', 'NUEVO'),
    ('10000000-0000-4000-8000-000000000010', 'EMPRESA', 'NUEVO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.personas_naturales (
    prestatario_id, dni, nombres, apellido_paterno, apellido_materno,
    fecha_nacimiento, fecha_validacion
)
VALUES
    ('10000000-0000-4000-8000-000000000001', '99000001', 'Ana Lucía', 'Torres', 'Mendoza', DATE '1990-04-12', now()),
    ('10000000-0000-4000-8000-000000000002', '99000002', 'Bruno Andrés', 'Salazar', 'Peña', DATE '1988-07-25', now()),
    ('10000000-0000-4000-8000-000000000003', '99000003', 'Carla Sofía', 'Ríos', 'Vega', DATE '1992-11-03', now()),
    ('10000000-0000-4000-8000-000000000004', '99000004', 'Diego Martín', 'Huamán', 'Flores', DATE '1985-02-18', now()),
    ('10000000-0000-4000-8000-000000000005', '99000005', 'Elena Paola', 'Castro', 'León', DATE '1991-09-21', now()),
    ('10000000-0000-4000-8000-000000000006', '99000006', 'Fabián José', 'Mendoza', 'Ruiz', DATE '1983-06-09', now()),
    ('10000000-0000-4000-8000-000000000007', '99000007', 'Gabriela Noemí', 'Paredes', 'Soto', DATE '1994-01-15', now()),
    ('10000000-0000-4000-8000-000000000008', '99000008', 'Hugo Daniel', 'Quispe', 'Lara', DATE '1989-12-08', now())
ON CONFLICT (prestatario_id) DO NOTHING;

INSERT INTO public.empresas (
    prestatario_id, ruc, razon_social, estado_ruc, condicion_ruc,
    direccion, departamento, provincia, distrito, ubigeo, fuente, consultado_en
)
VALUES
    (
        '10000000-0000-4000-8000-000000000009', '20131312955',
        'TRANSPORTES DEMO DEL NORTE S.A.C.', 'ACTIVO', 'HABIDO',
        'AV. TUPAC AMARU 185', 'LA LIBERTAD', 'TRUJILLO', 'TRUJILLO',
        '130101', 'SEED_DEMO', now()
    ),
    (
        '10000000-0000-4000-8000-000000000010', '20123456786',
        'EMPRESA BLOQUEADA DEMO S.A.C.', 'ACTIVO', 'HABIDO',
        'AV. PRUEBA 100', 'LIMA', 'LIMA', 'LIMA',
        '150101', 'SEED_DEMO', now()
    )
ON CONFLICT (prestatario_id) DO NOTHING;

-- La empresa elegible tiene representante validado y facultades acreditadas.
INSERT INTO public.representantes_empresa (
    id, empresa_id, persona_id, rol, autorizacion_comprobada,
    fuente, comprobado_en, evidencia_referencia
)
VALUES (
    '11000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000001',
    'REPRESENTANTE_LEGAL', TRUE, 'SEED_DEMO', now(), 'Partida demo, asiento A00001'
)
ON CONFLICT (id) DO NOTHING;

-- La segunda empresa queda sin representante para probar el bloqueo CA-08.

-- ---------------------------------------------------------------------------
-- 2) Préstamos y cronogramas
-- ---------------------------------------------------------------------------
-- Los importes de capital se distribuyen en cuotas iguales para que el seed
-- sea legible. La aplicación real genera cronograma francés desde la pantalla
-- de originación; la BD solo exige coherencia aritmética y suma de capital.
DO $$
DECLARE
    v_tasa NUMERIC := power(1.30::numeric, 1.0 / 12.0) - 1;
    v_p RECORD;
    v_n INTEGER;
    v_capital_base NUMERIC(12, 2);
    v_capital NUMERIC(12, 2);
    v_interes NUMERIC(12, 2);
    v_fecha DATE;
BEGIN
    FOR v_p IN
        SELECT *
        FROM (VALUES
            ('20000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000002'::uuid, 'TRU', 1800::numeric, 12, 'PENDIENTE_DESEMBOLSO', DATE '2026-10-19', 0::numeric, 1800::numeric),
            ('20000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000008'::uuid, 'CHI', 1200::numeric, 6, 'PENDIENTE_DESEMBOLSO', DATE '2026-10-19', 0::numeric, 1200::numeric),
            ('20000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000003'::uuid, 'CHI', 3500::numeric, 12, 'ACTIVO', DATE '2026-09-19', 3500::numeric, 0::numeric),
            ('20000000-0000-4000-8000-000000000004'::uuid, '10000000-0000-4000-8000-000000000004'::uuid, 'CBO', 2400::numeric, 12, 'ACTIVO', DATE '2026-07-19', 2200::numeric, 0::numeric),
            ('20000000-0000-4000-8000-000000000005'::uuid, '10000000-0000-4000-8000-000000000005'::uuid, 'PIU', 3200::numeric, 12, 'ACTIVO', DATE '2025-01-19', 3200::numeric, 0::numeric),
            ('20000000-0000-4000-8000-000000000006'::uuid, '10000000-0000-4000-8000-000000000006'::uuid, 'TUM', 2800::numeric, 12, 'ACTIVO', DATE '2024-01-19', 2800::numeric, 0::numeric),
            ('20000000-0000-4000-8000-000000000007'::uuid, '10000000-0000-4000-8000-000000000007'::uuid, 'CBO', 900::numeric, 3, 'PAGADO', DATE '2024-01-19', 0::numeric, 0::numeric),
            ('20000000-0000-4000-8000-000000000008'::uuid, '10000000-0000-4000-8000-000000000009'::uuid, 'TRU', 4500::numeric, 18, 'ACTIVO', DATE '2026-08-19', 4500::numeric, 0::numeric)
        ) AS datos(id, prestatario_id, sucursal_codigo, principal, plazo_meses, estado, fecha_originacion, capital_insoluto, reserva_capital)
    LOOP
        INSERT INTO public.prestamos (
            id, prestatario_id, sucursal_id, principal, capital_insoluto,
            reserva_capital, tea, plazo_meses, estado, fecha_originacion,
            creado_en, actualizado_en, desembolsado_en
        )
        VALUES (
            v_p.id,
            v_p.prestatario_id,
            (SELECT id FROM public.sucursales WHERE codigo = v_p.sucursal_codigo),
            v_p.principal,
            v_p.capital_insoluto,
            v_p.reserva_capital,
            0.30,
            v_p.plazo_meses,
            v_p.estado,
            v_p.fecha_originacion,
            v_p.fecha_originacion::timestamptz,
            now(),
            CASE WHEN v_p.estado IN ('ACTIVO', 'PAGADO') THEN v_p.fecha_originacion::timestamptz ELSE NULL END
        )
        ON CONFLICT (id) DO NOTHING;

        v_capital_base := round(v_p.principal / v_p.plazo_meses, 2);
        FOR v_n IN 1..v_p.plazo_meses LOOP
            v_capital := CASE
                WHEN v_n = v_p.plazo_meses THEN v_p.principal - v_capital_base * (v_p.plazo_meses - 1)
                ELSE v_capital_base
            END;
            v_interes := round((v_p.principal - v_capital_base * (v_n - 1)) * v_tasa, 2);
            v_fecha := (v_p.fecha_originacion + (v_n || ' month')::interval)::date;

            INSERT INTO public.cuotas (
                id, prestamo_id, numero, vencimiento, capital_programado,
                interes_programado, total_programado, estado
            )
            VALUES (
                md5(v_p.id::text || ':' || v_n::text)::uuid,
                v_p.id,
                v_n,
                v_fecha,
                v_capital,
                v_interes,
                v_capital + v_interes,
                CASE WHEN v_p.estado = 'PAGADO' THEN 'PAGADA' ELSE 'PENDIENTE' END
            )
            ON CONFLICT (id) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- Evidencias de desembolso para préstamos activos o pagados.
INSERT INTO public.desembolsos (
    id, prestamo_id, importe, metodo, referencia, sucursal_id, fecha, idempotency_key
)
VALUES
    ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 3500, 'TRANSFERENCIA', 'DEMO-TRF-3500', (SELECT id FROM public.sucursales WHERE codigo = 'CHI'), TIMESTAMPTZ '2026-09-19 10:00:00-05', 'seed-desembolso-003'),
    ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 2400, 'EFECTIVO', NULL, (SELECT id FROM public.sucursales WHERE codigo = 'CBO'), TIMESTAMPTZ '2026-07-19 11:00:00-05', 'seed-desembolso-004'),
    ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005', 3200, 'EFECTIVO', NULL, (SELECT id FROM public.sucursales WHERE codigo = 'PIU'), TIMESTAMPTZ '2025-01-19 12:00:00-05', 'seed-desembolso-005'),
    ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000006', 2800, 'EFECTIVO', NULL, (SELECT id FROM public.sucursales WHERE codigo = 'TUM'), TIMESTAMPTZ '2024-01-19 12:00:00-05', 'seed-desembolso-006'),
    ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000007', 900, 'EFECTIVO', NULL, (SELECT id FROM public.sucursales WHERE codigo = 'CBO'), TIMESTAMPTZ '2024-01-19 12:00:00-05', 'seed-desembolso-007'),
    ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000008', 4500, 'TRANSFERENCIA', 'DEMO-TRF-4500', (SELECT id FROM public.sucursales WHERE codigo = 'TRU'), TIMESTAMPTZ '2026-08-19 12:00:00-05', 'seed-desembolso-008')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Cobros de ejemplo
-- ---------------------------------------------------------------------------
-- Transferencia pendiente de verificación.
INSERT INTO public.pagos (
    id, prestamo_id, monto, medio, referencia, estado, registrado_en, idempotency_key
)
VALUES (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000003',
    300, 'TRANSFERENCIA', 'DEMO-PAGO-TRF-001', 'PENDIENTE_VERIFICACION',
    TIMESTAMPTZ '2026-10-18 09:30:00-05', 'seed-pago-transferencia-001'
)
ON CONFLICT (id) DO NOTHING;

-- Efectivo confirmado y parcialmente imputado a la primera cuota.
INSERT INTO public.pagos (
    id, prestamo_id, monto, medio, estado, confirmado_en, registrado_en,
    imputado_en, idempotency_key
)
VALUES (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000004',
    250, 'EFECTIVO', 'CONFIRMADO',
    TIMESTAMPTZ '2026-08-19 10:00:00-05', TIMESTAMPTZ '2026-08-19 10:00:00-05',
    TIMESTAMPTZ '2026-08-19 10:00:00-05', 'seed-pago-efectivo-002'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pagos_imputaciones (
    id, pago_id, cuota_id, importe_capital, importe_interes
)
VALUES (
    '41000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    md5('20000000-0000-4000-8000-000000000004:1')::uuid,
    200, 50
)
ON CONFLICT (id) DO NOTHING;

UPDATE public.cuotas
SET estado = 'PARCIAL'
WHERE id = md5('20000000-0000-4000-8000-000000000004:1')::uuid;

-- Pago de referencia para el préstamo cerrado.
INSERT INTO public.pagos (
    id, prestamo_id, monto, medio, estado, confirmado_en, registrado_en,
    imputado_en, idempotency_key
)
VALUES (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000007',
    1000, 'EFECTIVO', 'CONFIRMADO',
    TIMESTAMPTZ '2024-04-19 10:00:00-05', TIMESTAMPTZ '2024-04-19 10:00:00-05',
    TIMESTAMPTZ '2024-04-19 10:00:00-05', 'seed-pago-pagado-003'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Mora y cobranza extrajudicial
-- ---------------------------------------------------------------------------
INSERT INTO public.eventos_mora (
    id, prestamo_id, inicio_mora, monto_vencido, evidencia
)
VALUES
    (
        '50000000-0000-4000-8000-000000000005',
        '20000000-0000-4000-8000-000000000005',
        DATE '2025-02-20',
        (SELECT COALESCE(SUM(total_programado), 0) FROM public.cuotas WHERE prestamo_id = '20000000-0000-4000-8000-000000000005' AND vencimiento < CURRENT_DATE),
        jsonb_build_array(jsonb_build_object('origen', 'SEED_DEMO', 'detalle', 'Cuotas vencidas de demostración'))
    ),
    (
        '50000000-0000-4000-8000-000000000006',
        '20000000-0000-4000-8000-000000000006',
        DATE '2024-02-20',
        (SELECT COALESCE(SUM(total_programado), 0) FROM public.cuotas WHERE prestamo_id = '20000000-0000-4000-8000-000000000006' AND vencimiento < CURRENT_DATE),
        jsonb_build_array(jsonb_build_object('origen', 'SEED_DEMO', 'detalle', 'Caso escalado de demostración'))
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.expedientes_extrajudicial (
    id, prestamo_id, evento_mora_id, fecha_escalamiento, estado, accion, resultado
)
VALUES (
    '51000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000006',
    '50000000-0000-4000-8000-000000000006',
    DATE '2025-02-20', 'ABIERTO',
    'CONTACTO_INICIAL', 'Pendiente de respuesta del prestatario'
)
ON CONFLICT (id) DO NOTHING;

-- Fuerza la sincronización de estados por si el seed se reejecuta sobre una
-- base donde ya existían las filas y los triggers no llegaron a ejecutarse.
SELECT public.sincronizar_estado_prestatario(id)
FROM public.prestatarios
WHERE id IN (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000010'
);

COMMIT;

-- Referencias rápidas:
--   DNI 99000001 = persona sin préstamos (NUEVO) y representante acreditada.
--   DNI 99000002 / 99000008 = préstamos PENDIENTE_DESEMBOLSO.
--   DNI 99000003 = transferencia PENDIENTE_VERIFICACION.
--   DNI 99000004 = pago EFECTIVO parcial.
--   DNI 99000005 = mora abierta.
--   DNI 99000006 = mora + expediente EXTRAJUDICIAL.
--   DNI 99000007 = préstamo PAGADO.
--   RUC 20131312955 = empresa demo con representante acreditada.
--   RUC 20123456786 = empresa demo sin representación acreditada.
