# Respaldo y restauración verificable

Este procedimiento cubre CA-30 para el proyecto Supabase de producción. No sustituye las copias administradas por Supabase ni permite declarar el sistema apto para producción sin ejecutar y registrar la restauración.

## Respaldo

1. Usar una cuenta con permiso de proyecto y enlazar el CLI: `supabase link --project-ref <ref>`.
2. Exportar la base en un medio cifrado y fuera del repositorio:

   ```bash
   supabase db dump --linked --file respaldo-YYYYMMDD.sql
   ```

3. Guardar la fecha, responsable, hash SHA-256 del archivo y ubicación segura en la bitácora operativa.
4. Nunca versionar el dump, credenciales, claves de servicio ni archivos `.env`.

## Restauración de prueba

1. Crear una base o rama de prueba, nunca restaurar primero sobre producción.
2. Cargar el dump mediante el mecanismo autorizado por Supabase/PostgreSQL.
3. Ejecutar las pruebas SQL de `supabase/tests/` y verificar el conteo de `auditoria`, `pagos`, `pagos_reversiones` y `expedientes_extrajudicial`.
4. Registrar fecha, responsable, duración, resultado y diferencias encontradas.
5. Corregir cualquier diferencia antes de aprobar una restauración de producción.

## Evidencia de la prueba

Por cada restauración registrar en la issue de la entrega: identificador de la
copia, hash, rama/base de prueba, comandos ejecutados, resultado de cada suite
SQL y la hora de eliminación del entorno temporal. No se considera verificada
una restauración por el solo hecho de haber generado el dump.

## Periodicidad mínima

- Antes de aplicar migraciones de datos o cambios de seguridad.
- Tras cada entrega relevante del Sprint.
- En una prueba de restauración programada antes de cualquier uso real.

La bitácora `auditoria` es evidencia de operaciones; no reemplaza un respaldo externo cifrado.
