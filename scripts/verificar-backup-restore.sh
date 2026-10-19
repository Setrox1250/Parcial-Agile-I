#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Define SOURCE_DATABASE_URL con la base de origen}"
: "${RESTORE_DATABASE_URL:?Define RESTORE_DATABASE_URL con una base aislada}"

BACKUP_DIR="${BACKUP_DIR:-./tmp}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/backup-$(date -u +%Y%m%dT%H%M%SZ).dump"
HASH_FILE="${BACKUP_FILE}.sha256"

echo "Creando copia en $BACKUP_FILE"
pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --file "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" | tee "$HASH_FILE"

echo "Restaurando en la base aislada indicada por RESTORE_DATABASE_URL"
pg_restore "$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-acl "$BACKUP_FILE"

echo "Verificando objetos y controles HU-10"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT to_regclass('public.prestatarios') IS NOT NULL AS tiene_prestatarios;
SELECT to_regclass('public.prestamos') IS NOT NULL AS tiene_prestamos;
SELECT to_regclass('public.pagos') IS NOT NULL AS tiene_pagos;
SELECT to_regclass('public.auditoria') IS NOT NULL AS tiene_auditoria;
SELECT count(*) AS auditoria_total FROM public.auditoria;
SELECT count(*) AS pagos_confirmados FROM public.pagos WHERE estado = 'CONFIRMADO';
SELECT count(*) AS prestamos_activos FROM public.prestamos WHERE estado = 'ACTIVO';
SELECT has_table_privilege('anon', 'public.auditoria', 'SELECT') = false
  AS anon_sin_lectura_auditoria;
SQL

echo "Backup/restore verificado: $BACKUP_FILE"
