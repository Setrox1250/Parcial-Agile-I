# Procedimiento de backup y restore — HU-10

Este procedimiento deja una evidencia reproducible de continuidad operativa sin afirmar que una copia es utilizable hasta restaurarla en una base de prueba.

## 1. Preparar la copia

Usa una base de prueba o una conexión de solo lectura para el origen. Nunca ejecutes `pg_restore --clean` contra producción.

```bash
export SOURCE_DATABASE_URL='postgresql://...'
export BACKUP_FILE="./tmp/backup-$(date -u +%Y%m%dT%H%M%SZ).dump"
mkdir -p ./tmp
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" | tee "${BACKUP_FILE}.sha256"
```

La copia y su hash se conservan fuera del repositorio. No se deben registrar secretos, JWT, tokens ni datos completos de identidad en tickets o logs.

## 2. Restaurar en una base aislada

```bash
export RESTORE_DATABASE_URL='postgresql://...'
pg_restore \
  --dbname "$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$BACKUP_FILE"
```

La base destino debe ser desechable y tener la misma versión mayor de PostgreSQL y las extensiones requeridas por Supabase.

## 3. Verificar integridad mínima

```bash
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
```

La evidencia de aceptación debe conservar: fecha UTC, versión de la aplicación, hash de la copia, origen/destino (sin credenciales), resultado de cada consulta y el nombre del operador que aprobó la restauración.

## 4. Automatización local

El script `scripts/verificar-backup-restore.sh` ejecuta el dump, hash, restore y las comprobaciones contra las URLs que se le entreguen. Requiere que el destino sea una base aislada; no crea ni elimina recursos remotos automáticamente.

La issue HU-10 solo se puede cerrar después de adjuntar una ejecución real de este procedimiento en una base de prueba válida.
