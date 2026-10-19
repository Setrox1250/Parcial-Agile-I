# Guía de pruebas end-to-end

## Preparación

1. Verifica que la base tenga aplicadas todas las migraciones.
2. Ejecuta `supabase/seed-demo.sql` una sola vez desde el SQL Editor de Supabase con un rol privilegiado. Para el stack local:

   ```bash
   docker exec -i supabase_db_parcial-agile psql -U postgres -d postgres \
     -v ON_ERROR_STOP=1 -f - < supabase/seed-demo.sql
   ```

3. Inicia sesión con un usuario `ADMIN` para recorrer todo el sistema. Para probar alcance por sede, usa también un `SUPERVISOR_FINANCIERO` con sucursal asignada.
4. Para probar sin proveedores externos, configura en `frontend/.env`:

   ```env
   VITE_MOCK_DNI=1
   VITE_MOCK_RUC=1
   ```

   Reinicia Vite después de cambiar el archivo.

## Datos demo disponibles

| Consulta | Caso esperado |
| --- | --- |
| DNI `99000001` | Persona sin préstamos: estado NUEVO; también representante de la empresa demo. |
| DNI `99000002` o `99000008` | Préstamos pendientes de desembolso. |
| DNI `99000003` | Préstamo ACTIVO con transferencia pendiente de verificación. |
| DNI `99000004` | Préstamo ACTIVO con pago efectivo parcial. |
| DNI `99000005` | Préstamo ACTIVO con mora abierta. |
| DNI `99000006` | Mora abierta y expediente EXTRAJUDICIAL. |
| DNI `99000007` | Préstamo PAGADO. |
| RUC `20131312955` | Empresa activa/habida con representante acreditado. |
| RUC `20123456786` | Empresa demo sin representación acreditada: debe bloquear originación. |

El seed no elimina datos existentes y reserva sus filas con UUIDs que empiezan por `1000…` (fichas), `2000…` (préstamos), `3000…` (desembolsos), `4000…` (pagos) y `5000…` (mora).

## Flujos funcionales

### 1. Acceso, roles y alcance

1. Inicia sesión y confirma que `/` muestra el resumen.
2. Con `ADMIN`, verifica **Usuarios**, **Auditoría** y la consulta global.
3. Con `SUPERVISOR_FINANCIERO`, verifica que solo aparezcan clientes/préstamos de su sucursal.
4. En **Usuarios**, crea un supervisor con una sucursal, cierra sesión e inicia con él.
5. Intenta desactivar el usuario actualmente autenticado: debe quedar bloqueado por la regla de no desactivarse a sí mismo.

### 2. Identidad de persona y nuevo crédito

1. Abre **Nuevo crédito** (`/identidad`) y consulta `12345678` con mocks activos.
2. Verifica nombre proveniente del proveedor, ficha NUEVA y evaluación de cupo.
3. Continúa a préstamo, elige monto/plazo, revisa el cronograma y confirma la originación.
4. Comprueba que el préstamo aparece como `PENDIENTE_DESEMBOLSO` en **Desembolsos**.
5. Repite con `87654321` para validar ficha existente.
6. Prueba errores: `22222222` (menor de edad), `44444444` (discrepancia), `99999999` (no encontrado) y `55555555` (error de proveedor).

### 3. Empresa, RUC y representante automático

1. Abre **Empresa** (`/empresa`) e ingresa `20131312955`.
2. En la misma tarjeta deben aparecer RUC, razón social, estado/condición, representante legal, DNI, cargo y datos completos del DNI.
3. Confirma que la búsqueda del representante legal se ejecutó automáticamente después del RUC; no debe existir un segundo botón de búsqueda.
4. Revisa las facultades, marca la confirmación y acredita al representante.
5. Avanza a elegibilidad y origina un préstamo empresarial.
6. Busca `20123456786`: debe mostrar la empresa sin representación acreditada y bloquear la originación.

### 4. Expediente 360

1. Abre **Expedientes** (`/consulta`) y usa la búsqueda por nombre, DNI o RUC.
2. Prueba filtros de tipo/estado y paginación del directorio.
3. Abre `99000003`, `99000004`, `99000005` o `99000006`.
4. En **Préstamos**, expande la fila para revisar cuotas, abonado, saldo y estado del préstamo.
5. En un préstamo `ACTIVO` con saldo, pulsa **Registrar cobro**: el préstamo debe llegar preseleccionado.
6. En un préstamo `PAGADO` o `ANULADO_SIN_DESEMBOLSO`, confirma que no aparece la acción de cobro.
7. Revisa las pestañas **Pagos** y **Expedientes**.

### 5. Desembolso

1. Abre **Desembolsos** (`/desembolsos`); usa búsqueda, filtro y paginación.
2. En un pendiente elige `EFECTIVO` y confirma: pasa a `ACTIVO` y aparece en el historial.
3. En otro pendiente elige `TRANSFERENCIA`: sin referencia debe rechazar; con referencia debe confirmar.
4. Prueba **Anular** en un pendiente y confirma que desaparece de la cola y queda `ANULADO_SIN_DESEMBOLSO`.
5. Reintenta una confirmación: la segunda operación no debe crear otra evidencia.

### 6. Cobranza y verificación

1. Abre **Cobranza** (`/cobranzas`) y revisa el historial.
2. Registra un pago `EFECTIVO` sobre un préstamo `ACTIVO`: queda confirmado e imputado a las cuotas.
3. Registra una `TRANSFERENCIA` con referencia: queda `PENDIENTE_VERIFICACION` y no cambia el saldo todavía.
4. Confirma la transferencia desde la cola de verificación y revisa que el saldo/cuotas se actualicen.
5. Rechaza otra transferencia y verifica que no impute saldo.
6. Repite el registro desde el botón de cobro del expediente 360.
7. Intenta cobrar un préstamo pendiente, pagado o anulado: debe rechazarse por estado no activo.

### 7. Mora y cobranza extrajudicial

1. Abre **Mora** (`/mora`) y revisa los casos `99000005` y `99000006`.
2. Confirma que el proceso diario muestra la mora abierta y que los estados de ficha son `MOROSO` y `EXTRAJUDICIAL` respectivamente.
3. Como `ADMIN`, pulsa **Reprocesar mora** y verifica que la ejecución queda registrada.
4. Abre el expediente 360 de `99000006` y revisa el expediente extrajudicial, fecha de escalamiento, acción y resultado.
5. Registra un pago suficiente para regularizar una cuota y comprueba que la mora se cierre al reprocesar; el expediente histórico no se elimina.

### 8. Auditoría e idempotencia

1. En **Auditoría** (`/auditoria`), filtra por entidad, acción, sucursal y fecha.
2. Confirma que originación, desembolso, cobro, verificación, mora y acreditación dejaron eventos.
3. Reintenta una originación/desembolso/cobro usando el mismo envío: debe devolver el resultado idempotente sin duplicar filas.
4. Verifica que un pago revertido conserva el histórico y genera una operación compensatoria, nunca un borrado.

## Resultado esperado mínimo

Al terminar, el entorno debe mostrar al menos una ficha NUEVA, una REGULAR, una MOROSA y una EXTRAJUDICIAL; un préstamo pendiente, activo, pagado y anulado; un pago efectivo confirmado, una transferencia pendiente, una transferencia rechazada y un expediente extrajudicial abierto.
