-- Se retira la edición de términos desde el flujo de desembolsos.
DROP FUNCTION IF EXISTS public.editar_prestamo_pendiente(UUID, NUMERIC, INTEGER, JSONB);
