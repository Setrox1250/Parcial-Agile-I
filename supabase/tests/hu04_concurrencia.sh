#!/usr/bin/env bash
# HU-04 / CP-16: dos sedes reservan simultáneamente; la exposición no supera S/ 10 000.
# RN-32: FOR UPDATE de la fila del prestatario serializa las originaciones.
# Ejecutar con el stack local arriba y las migraciones aplicadas:
#   bash supabase/tests/hu04_concurrencia.sh
set -euo pipefail

CONTENEDOR=$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -n1)
if [ -z "$CONTENEDOR" ]; then
  echo "No se encontró el contenedor de la BD local (supabase_db_*)"
  exit 1
fi

PSQL="docker exec -i $CONTENEDOR psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1"

# Limpieza re-ejecutable del prestatario de prueba (HU-03: DNI en personas_naturales).
$PSQL <<'SQL'
DO $$
DECLARE v_id uuid;
BEGIN
    SELECT prestatario_id INTO v_id
    FROM public.personas_naturales WHERE dni = '11111111';

    IF v_id IS NOT NULL THEN
        DELETE FROM public.expdedientes_extrajudicial
        WHERE prestamo_id IN (SELECT id FROM public.prestamos WHERE prestatario_id = v_id);
        DELETE FROM public.eventos_mora
        WHERE prestamo_id IN (SELECT id FROM public.prestamos WHERE prestatario_id = v_id);
        DELETE FROM public.prestamos WHERE prestatario_id = v_id;
        DELETE FROM public.prestatario_incidencias WHERE prestatario_id = v_id;
        DELETE FROM public.personas_naturales WHERE prestatario_id = v_id;
        DELETE FROM public.prestatarios WHERE id = v_id;
    END IF;
END $$;
SQL

read -r PRESTATARIO_ID SUC_TRU SUC_PIU <<EOF
$($PSQL <<'SQL'
WITH p AS (
    INSERT INTO public.prestatarios (tipo, estado)
    VALUES ('PERSONA_NATURAL', 'NUEVO')
    RETURNING id
), pn AS (
    INSERT INTO public.personas_naturales (
        prestatario_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento
    )
    SELECT p.id, '11111111', 'Concurrencia', 'CP', 'Dieciseis', DATE '1990-01-01'
    FROM p
    RETURNING prestatario_id
)
SELECT concat_ws(' ', pn.prestatario_id, t.id, u.id)
FROM pn
CROSS JOIN (SELECT id FROM public.sucursales WHERE codigo = 'TRU') t
CROSS JOIN (SELECT id FROM public.sucursales WHERE codigo = 'PIU') u;
SQL
)
EOF

if [ -z "${PRESTATARIO_ID:-}" ]; then
  echo "No se pudo crear el prestatario de prueba"
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Dos sesiones psql independientes en paralelo: 6 000 + 6 000 > 10 000.
docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 \
  -c "SELECT jsonb_pretty(public.reservar_cupo('$PRESTATARIO_ID', 6000, 24, '$SUC_TRU', NULL, 'cp16-tru'));" \
  > "$TMP/tru.txt" &
PID_TRU=$!

docker exec -i "$CONTENEDOR" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 \
  -c "SELECT jsonb_pretty(public.reservar_cupo('$PRESTATARIO_ID', 6000, 24, '$SUC_PIU', NULL, 'cp16-piu'));" \
  > "$TMP/piu.txt" &
PID_PIU=$!

wait "$PID_TRU"
wait "$PID_PIU"

OKS=$(cat "$TMP/tru.txt" "$TMP/piu.txt" | grep -c '"ok": true' || true)
OCUPADO=$($PSQL -c "SELECT public.calcular_exposicion('$PRESTATARIO_ID');")

echo "TRU: $(tr -d '\n' < "$TMP/tru.txt")"
echo "PIU: $(tr -d '\n' < "$TMP/piu.txt")"
echo "reservas ok: $OKS / exposición final: S/ $OCUPADO"

if [ "$OKS" -ne 1 ]; then
  echo "FALLO CP-16: se esperaba exactamente 1 reserva exitosa, hubo $OKS"
  exit 1
fi

if [ "$OCUPADO" != "6000.00" ]; then
  echo "FALLO CP-16: exposición esperada 6000.00, obtenida $OCUPADO"
  exit 1
fi

echo "OK CP-16: dos sedes en paralelo no exceden S/ 10 000 (una sola reserva ganadora)"
