---
title: "Sistema de Préstamos Multisucursal — MVP y Sprint 01"
version: "1.4 consolidada"
fecha: "2026-10-18"
marco: "Scrum"
orientacion: "especificación ejecutable por desarrolladores y agentes IA"
base: "Plan_Sprint1_MVP_Prestamos_Multisucursal_v1.2.pdf (27 páginas)"
stack: "React + Vite + JavaScript / Cloudflare Pages / Supabase Auth + PostgreSQL + Edge Functions"
moneda: "PEN"
tasa: "TEA fija 30 % (invariable durante el contrato)"
limite_exposicion_pen: 10000
plazo_meses: "1..60"
estado: "Especificación funcional actualizada; contiene validaciones previas a producción"
---

# Sistema de Préstamos Multisucursal

**Alcance funcional, reglas de negocio, historias de usuario, pruebas de aceptación y arquitectura del MVP — Sprint 01 / versión 1.4**

> **Propósito del incremento:** entregar software funcional que impida inconsistencias en la identidad del prestatario y en sus obligaciones, unifique los clientes de todas las sucursales, aplique políticas de crédito y permita controlar cobros y escalamiento por mora. La evaluación del Sprint se basa prioritariamente en el **software integrado funcionando** y en la Sprint Review, no en producir documentación extensa.

> **Jerarquía de fuentes.** `[BASE]`: documento original y PDF v1.2; `[PROF]`: reglas expresamente atribuidas al profesor en la solicitud del 18/10/2026; `[DIS]`: decisión de diseño propuesta para hacer la regla comprobable, todavía ratificable. Las reglas nuevas sustituyen textos incompatibles de v1.2; **no** se mantienen simultáneamente las definiciones antiguas.

## 1. Resultado esperado y límite del MVP

Una empresa prestamista tiene errores de transcripción y duplicados en nombres de clientes. Un cliente puede obtener préstamos en distintas sedes, pero su historial de pagos, capacidad disponible y restricciones deben ser comunes a toda la organización. El MVP prioriza esa consistencia.

**Recorrido mínimo de extremo a extremo:** autenticación → consultar DNI peruano o RUC empresarial → identificar ficha única → comprobar restricciones y cupo → registrar préstamo y cronograma → confirmar desembolso → registrar abono o cuota adelantada → actualizar saldo de capital y cupo → detectar mora y escalar a cobranza extrajudicial cuando corresponda.

### 1.1 Dentro del Sprint 01

- Acceso por roles y sucursal; base de datos compartida y una ficha global por prestatario.
- Persona natural **peruana**, mayor de edad, identificada por DNI; consulta real de nombres, apellidos y nacimiento mediante Scrall Básico. Se requiere **DNI vigente**, con salvedad técnica detallada en §3.
- Persona jurídica constituida en Perú: identificación por RUC, razón social, representante con DNI y autorización registrada; validación contra consulta RUC oficial o fuente comprobada, sin afirmar que Scrall DNI verifica empresas.
- Préstamos con **TEA fija e invariable del 30 % durante toda su vigencia**, plazo **1 a 60 meses**, sin mínimo comercial de principal, máximo de exposición global S/ 10 000 por prestatario, incluyendo sedes.
- Cronograma desglosado en capital e intereses, con vencimientos y saldo actualizado.
- Cobranza manual confirmada (efectivo o transferencia verificada), abonos parciales, pago de cuotas futuras por adelantado **con intereses programados invariables**, sin producto de amortización extraordinaria a capital en este MVP.
- Mora al superar la fecha de vencimiento impaga; bloqueo de crédito y escalamiento a **EXTRAJUDICIAL** tras un año continuo de mora.
- Auditoría de operaciones, trazabilidad de movimientos, idempotencia, restricciones SQL, segregación por sede y consulta administrativa consolidada.

### 1.2 Excluido expresamente

- Biometría, autenticación facial, registro de préstamos con carné de extranjería o pasaporte, prestatarios extranjeros no domiciliados y toda originación para persona natural no peruana.
- Pasarela de pago, cobro automático, transferencia iniciada por el sistema, conciliación bancaria automática, consulta SBS de deudas de terceros y scoring externo.
- Reprogramación, refinanciamiento, capitalización de mora, sanciones monetarias e interés moratorio adicional (salvo nueva aprobación).
- Función especial de **«liquidar deuda»**, condonación, castigo, acuerdo extrajudicial automatizado o recalculo del cronograma para quitar intereses futuros por simple adelanto de cuotas. *Pagar todas las cuotas conforme al contrato* lleva a `PAGADO`, sin constituir un trámite especial de liquidación.
- Lista de tareas/subtareas como entregable evaluativo: se documentan historias, criterios, pruebas y Definition of Done en el marco Scrum.

### 1.3 Magnitud del MVP

El tamaño del MVP no es un criterio de calificación: se considerará terminado un **incremento funcional coherente**, por pequeño que sea, si cumple lo comprometido en el Sprint Goal y las reglas de aceptación; no se promete que el sistema cubra todos los procesos de una financiera.

## 2. Catálogo de políticas aprobadas y precisiones

| Tema | Regla vigente | Estado / observación |
|---|---|---|
| Identidad natural | Solo personas naturales peruanas con **DNI vigente**; excluir carné, pasaporte y extranjeros no domiciliados | `[PROF]` y **bloqueo técnico de validación automática** §3 |
| Identidad jurídica | Se permiten préstamos **a nombre de empresas peruanas** con RUC y representante identificado | `[PROF]`; canal de verificación de facultades por ratificar |
| Nombres correctos | Datos del DNI recuperados de Scrall; cliente único, discrepancia bloquea originación | `[BASE]` |
| Interés | **30 % de tasa efectiva anual (TEA) fija**: no cambia durante la vigencia del préstamo, ni por adelantar cuotas. El cronograma contratado conserva sus importes de interés programado | `[PROF]` |
| Plazo | **1 a 60 meses**, inclusive | `[PROF]` |
| Principal mínimo | Sin mínimo comercial; debe ser mayor que cero por integridad de transacción | `[PROF]` + precisión técnica |
| Tope | S/ 10 000 de **capital insoluto más reservas** por prestatario en todas las sedes | `[PROF]` y adenda v1.2 |
| Reutilización de cupo | Amortización de capital confirmada libera cupo de inmediato, no los intereses | `[PROF]` y adenda v1.2 |
| Nuevos créditos | Clientes regulares pueden tener varios préstamos al día sin superar cupo | `[BASE]`; definición formal de REGULAR por acordar |
| Mora | Si pasó la fecha exigible de cuota y queda saldo, se vuelve MOROSO | `[PROF]`; interpretación de «30 días» §5 |
| Extrajudicial | Un año completo de mora continua dispara clasificación/proceso EXTRAJUDICIAL | `[PROF]`; el proceso externo no se automatiza |
| Adelanto | Se pueden adelantar cuotas futuras incluyendo su interés pactado; no prepago extraordinario a capital en el MVP | `[PROF]`; riesgo legal §11 |
| Sucursales | Chimbote, Chiclayo, Trujillo, Tumbes, Piura **como lista provisional** | `[PROF]`; confirmar número/sedes finales antes de sembrar datos |
| Marco de trabajo | Scrum: Sprint Goal, backlog de HU, incremento probado, Review y Retro | `[PROF]` |

## 3. Identidad y veracidad: restricciones no negociables

### 3.1 Persona natural

1. El empleado proporciona **únicamente un DNI de 8 caracteres numéricos**, manteniendo ceros a la izquierda.
2. Una Edge Function consulta realmente `POST https://api.scrall.net/v1/reniec/basico` y valida `message="found data"`, `nuDni` coincidente, nombres/apellidos y fecha de nacimiento válidos.
3. El sistema impide edición ordinaria de nombres y valida edad **≥ 18 años** con `America/Lima`.
4. La base impone `UNIQUE(tipo_documento, numero_documento)` y reutiliza ficha global existente. Si la nueva respuesta difiere, bloquea originación hasta corrección autorizada, dejando historial anterior/nuevo.
5. Extranjeros, carné de extranjería, pasaportes y otros documentos **no** habilitan créditos de persona natural.
6. Ningún registro pasa a elegible por error, timeout o falta de respuesta del proveedor.

**Brecha crítica de costo cero:** Scrall `reniec_basico` **no devuelve fecha de caducidad ni estado de vigencia del DNI**. El proveedor indica que la caducidad está en `reniec_intermedio`, fuera del único endpoint del plan básico gratuito. Por ello un resultado válido de Scrall Básico **no prueba DNI vigente**. No programar `dni_vigente=true` sin evidencia. La política de vigencia queda como **criterio bloqueante de aceptación** hasta disponer de fuente verificable autorizada o mecanismo adicional formalmente aprobado; no se presenta como implementada automáticamente a S/ 0.

### 3.2 Persona jurídica

- Tipo `EMPRESA_PERUANA`; `RUC` de 11 dígitos único, razón social, estado de RUC, condición de domicilio, representante y evidencia de facultades de representación.
- Consulta RUC oficial **SUNAT** gratuita para verificación operativa de razón social, estado **ACTIVO** y condición **HABIDO**. La consulta pública no implica que exista una API oficial pública, gratuita e ilimitada para automatización; la comprobación puede requerir verificación guiada por usuario autorizado y registro de procedencia/fecha.
- Identificar al representante legal por DNI peruano, contrastar datos básicos con Scrall y comprobar autorización/representación por proceso aprobado. **Un RUC activo no demuestra poderes vigentes del representante**.
- Cliente empresa y cliente persona natural son deudores distintos: el cupo de la empresa es global por **RUC**, no se imputa automáticamente al representante; las garantías personales no están contempladas.
- No crear empresa con razón social inventada ni usar un RUC inválido. Si faltan los controles indicados, la originación empresarial queda bloqueada, aunque exista formulario.

## 4. Reglas de negocio consolidadas

La matriz sustituye RN de v1.2 donde hay cambios (especialmente interés, gracia, clasificación, pagos y estados). Los controles decisivos se hacen **en backend/BD**, nunca solo en el navegador.

| ID | Regla y criterio verificable | Origen |
|---|---|---|
| RN-01 | La persona natural se registra con DNI peruano de 8 dígitos, único en toda la empresa. | BASE/PROF |
| RN-02 | Nombre y apellidos del prestatario natural se obtienen de Scrall Básico, no del texto del empleado. | BASE |
| RN-03 | Si la consulta devuelve datos incompletos, DNI distinto o error, no hay originación. | BASE |
| RN-04 | Solo prestatarios naturales peruanos con DNI **vigente y verificable**, mayores de 18 años; no pasaportes ni carné de extranjería. | PROF; brecha §3 |
| RN-05 | Si el DNI ya existe y el nombre difiere, bloquear nueva originación y registrar incidencia de corrección con auditoría. | BASE |
| RN-06 | La tasa pactada es **TEA fija del 30 % durante todo el contrato**, no un recargo único del 30 % sobre cualquier plazo. No puede cambiar por decisión del empleado, el sistema ni por adelanto de cuotas. | PROF |
| RN-07 | Plazo de préstamo desde **1 hasta 60 meses**, inclusive; fuera de rango se rechaza. | PROF |
| RN-08 | No hay principal mínimo comercial, pero `principal > 0`, PEN y máximo dos decimales. | PROF |
| RN-09 | `exposición_global = Σ(capital_insoluto ACTIVO) + Σ(capital_reservado PENDIENTE_DESEMBOLSO)` por prestatario en todas las sucursales. | PROF/v1.2 |
| RN-10 | `exposición_global + principal_solicitado ≤ S/ 10 000`; si se excede, la operación no se crea. | PROF/v1.2 |
| RN-11 | Solo la **porción de capital** de cobros confirmados reduce exposición; pagar interés no libera cupo. | PROF/v1.2 |
| RN-12 | Si la exposición desciende de S/ 10 000, el cupo puede reutilizarse dentro de política de elegibilidad. | PROF |
| RN-13 | Si existe otro préstamo activo, solo cliente clasificado REGULAR, sin mora ni extrajudicial, puede contratar otro. | BASE/PROF |
| RN-14 | Cliente NUEVO elegible puede acceder a su primer préstamo; REGULAR requiere criterio objetivo ratificado y no se etiqueta manualmente. | BASE/DIS |
| RN-15 | Cliente MOROSO o con cobranza EXTRAJUDICIAL **no** obtiene ningún crédito nuevo, aunque haya cupo. | PROF |
| RN-16 | Préstamo contiene prestatario, sucursal origen, usuario, fecha, principal, TEA, plazo, cronograma y estado. | PROF |
| RN-17 | Cuotas contienen fecha de vencimiento, capital, interés, total, pagado y saldo calculado desde transacciones confirmadas. | PROF |
| RN-18 | Cronograma conserva interés previsto en cuotas adelantadas; no se elimina interés por elegir pagar una cuota futura. | PROF |
| RN-19 | Se admiten cobros completos, parciales y pagos adelantados de cuotas del cronograma, en efectivo o transferencia verificada. | v1.1/PROF |
| RN-20 | El cobro confirmado se imputa cronológicamente a cuotas pendientes; admite cubrir varias cuotas con un mismo pago. | v1.1 |
| RN-21 | `saldo_cuota = total_cuota − Σ(imputaciones_confirmadas)`; nunca negativo ni sobrepago. | v1.1 |
| RN-22 | Cada imputación distingue **capital e interés**; su suma coincide con el pago confirmado y con el cronograma aprobado. | v1.2 |
| RN-23 | Las transferencias pendientes de verificación no disminuyen deuda ni exposición. | BASE |
| RN-24 | El pago adelanta vencimientos, **no** recalcula tasas, capital contractual ni intereses de cuotas futuras por simple adelanto. | PROF |
| RN-25 | No existe flujo especial `LIQUIDAR_DEUDA`; no existe condonación ni castigo en este MVP. Completar el pago de todas las cuotas lleva a `PAGADO` automáticamente. | PROF/DIS |
| RN-26 | `MOROSO` cuando una cuota sigue impaga **después de su vencimiento**; sin gracia adicional salvo ratificación expresa. | PROF |
| RN-27 | Si hay mora **continua por un año calendario**, se crea/escalona expediente `EXTRAJUDICIAL`, conservando deuda y trazas. | PROF/DIS |
| RN-28 | Una vez escalado, el evento extrajudicial permanece en historial aunque posteriormente se regularice; no se elimina automáticamente. | DIS |
| RN-29 | El pago recibido después del escalamiento se registra normalmente; no condona ni desaparece la deuda por cambiar el estado. | DIS |
| RN-30 | Sucursal se deriva de la sesión autorizada; empleado no puede alterar sede de un préstamo ajeno. | BASE |
| RN-31 | Alta, reserva de cupo, desembolso, imputaciones y cambio de estados usan transacciones e idempotencia. | BASE/v1.2 |
| RN-32 | Solicitudes concurrentes de distintas sedes serializan cambios del mismo prestatario para no superar S/ 10 000. | BASE/v1.2 |
| RN-33 | No hay edición destructiva de pagos confirmados; ajustes mediante reversión compensatoria auditada. | BASE/v1.1 |
| RN-34 | Datos personales y secretos protegidos, sin payload de identidad completo en logs; solo datos mínimos para auditoría. | BASE |
| RN-35 | El RUC único identifica empresas peruanas; se coteja razón social, estado activo/habido y autoridad del representante antes de contratar. | PROF/DIS |
| RN-36 | La empresa y su representante tienen historiales diferentes; el cupo de S/ 10 000 se aplica **por prestatario**, DNI o RUC. | DIS |
| RN-37 | No hay penalidades ni intereses moratorios añadidos; mora es estado de gestión y restricción, no un cobro adicional. | v1.1 |
| RN-38 | Los eventos de mora y extrajudicial usan zona `America/Lima` y cálculo desde vencimientos/pagos confirmados, no un flag editable. | PROF/DIS |
| RN-39 | El módulo admite sedes configuradas sin base independiente; la lista Chimbote, Chiclayo, Trujillo, Tumbes, Piura debe confirmarse. | PROF |
| RN-40 | El incremento se considera completo por aceptación de funcionalidades probadas bajo Scrum, no por volumen de documentación o cantidad de pantallas. | PROF |
| RN-41 | **Invariabilidad del interés pactado:** al confirmar el desembolso se fija la TEA de 30 % y el cronograma de capital/interés. Los pagos parciales y adelantos de **cuotas programadas** no modifican la tasa ni eliminan, rebajan o recalculan el interés contractual previsto en esas cuotas. Solo cambios formalmente autorizados o exigidos por la normativa aplicable podrán originar una nueva versión auditable del cronograma; no existe edición silenciosa. | PROF |

### 4.1 Cupo y capital amortizado (obligatorio)

```text
limite = S/ 10 000.00 por prestatario (DNI o RUC)
ocupado = suma(capital_insoluto de préstamos ACTIVOS)
        + suma(capital reservado en PENDIENTE_DESEMBOLSO)
disponible = max(0, limite - ocupado)
solicitud_elegible = identidad_validada
                  y cliente_habilitado (sin MOROSO ni EXTRAJUDICIAL)
                  y (sin préstamo activo o clasificación REGULAR)
                  y monto_solicitado > 0
                  y monto_solicitado <= disponible
```

**Ejemplo financiero:** si un prestatario mantiene S/ 10 000 de **capital insoluto** y un conjunto de cobros confirmados amortiza S/ 5 000 de **capital** (separados de intereses), el nuevo cupo es **S/ 5 000**, no S/ 0. Si el pago total de S/ 5 000 contenía S/ 600 de intereses, el capital liberado sería S/ 4 400 y el cupo S/ 4 400. No confundir dinero recibido con capital amortizado.

El ejemplo anterior requiere que el prestatario sea **REGULAR**, no MOROSO, no EXTRAJUDICIAL, y que no exista otra reserva. La base de datos verificará cupo y reserva atómicamente, incluso con dos sedes originando operaciones simultáneas.

### 4.2 Cálculo con TEA del 30 %

- **Tasa aprobada:** TEA **fija e invariable** 30 % (`0.30`) durante toda la vigencia de cada préstamo; no se modifica por tiempo transcurrido, cambios operativos ni por pagar cuotas antes de su vencimiento.
- **Conversión a tasa de un mes bajo periodos mensuales homogéneos:** `i_m = (1 + 0.30)^(1/12) - 1` ≈ **2.210445 % mensual**.
- **Método propuesto `[DIS]`: francés, cuota constante**, `cuota = P * i_m / (1 - (1+i_m)^(-n))`, con `1 ≤ n ≤ 60` cuotas mensuales.
- **Desglose por periodo:** `interés_periodo = capital_insoluto_inicio * tasa_periodica`; `amortización_periodo = cuota − interés_periodo`; ajustar centavos en última cuota, calculando con decimal y no float. **Los importes de interés pueden ser distintos entre cuotas** por el capital amortizado; lo que no varía es la TEA contractual ni los importes del cronograma pactado por el simple adelanto de cuotas.
- **Fechas:** proponer vencimientos por mes calendario, conservando día de mes o último día válido. Si «30 días» del profesor exige intervalos exactamente de 30 días, se deben cambiar periodicidad y conversión a base diaria; no asumir equivalencia entre mes calendario y 30 días.
- La **TEA fija del 30 % está aprobada y no es reajustable** durante la vigencia contractual. Sin embargo, el método francés, la convención de vencimientos, la base de días y la relación contractual con adelantos requieren **ratificación antes de conceder créditos reales**.

> **Interpretación de «el interés nunca cambia»:** no quiere decir que cada cuota contenga idéntico monto en soles de intereses. Quiere decir que **la tasa pactada permanece en 30 % TEA**, y que un **adelanto de cuotas** no genera una tasa nueva ni una rebaja automática de los intereses previstos en el cronograma original. Esta definición no pretende excluir eventuales derechos legales de pago anticipado con reducción de intereses cuando correspondan; ver §9.2, B-02.

### 4.3 Adelantos y pagos parciales

1. Se registra un cobro por importe positivo **sin superar suma de cuotas impagas**; se pueden cubrir cuotas no vencidas, incluida la primera.
2. Orden de imputación: cuota impaga más antigua y luego siguientes, mostrando antes de confirmar la distribución capital/interés de las cuotas cubiertas.
3. Una cuota parcialmente cubierta es `PARCIAL`; pasa a `PAGADA` solo al cubrir todo el importe programado.
4. En adelanto de cuotas **se conserva íntegramente el interés pactado de las cuotas futuras y la TEA contractual del 30 % no cambia**; el contrato y cronograma original no se rehacen por adelantar vencimientos. La porción de capital prevista en cada cuota pagada se amortiza y libera cupo; la porción de interés no.
5. Transferencia con mera referencia queda `PENDIENTE_VERIFICACION`, sin afectar saldos. Efectivo se confirma por responsable autorizado; la transferencia requiere verificación manual del abono.
6. No existe botón «liquidar deuda». Si el prestatario paga todas las cuotas mediante el flujo ordinario, `PAGADO` se deriva automáticamente. Ningún interés futuro se elimina **por la funcionalidad de adelanto**.
7. **Salvedad jurídica:** la distinción entre adelanto de cuotas y pago anticipado de capital debe respetar derechos legales aplicables; no afirmar que la empresa puede impedir todo prepago. Ver §11.

### 4.4 Mora y escalamiento extrajudicial

**Interpretación operativa `[DIS]` de «fecha de cuota (30 días)»:** se entienden cuotas mensuales aproximadamente cada 30 días y la **mora inicia al día siguiente del vencimiento**, si hay saldo positivo. *No* se añaden automáticamente 30 días de gracia. Esta decisión sustituye la gracia configurable de la adenda v1.1 y requiere validación si el profesor quiso decir «30 días de gracia».

- Fecha de vencimiento = día exigible inclusive; al comenzar el siguiente día local, si no se cubrió, `MOROSO=true`.
- El sistema registra `inicio_mora` de la **deuda morosa continua**: fecha de primer día en que existió al menos una cuota en mora y no hubo regularización total de cuotas vencidas.
- Si la mora continua alcanza su aniversario de **un año calendario**, se crea expediente de cobranza `EXTRAJUDICIAL` con `fecha_escalamiento`, préstamo, cliente, sucursal y actor/proceso; se bloquea originación en toda la empresa.
- Si se regulariza la deuda vencida **antes** del año, la racha se cierra y una mora posterior inicia nuevo cómputo. Si el caso ya fue escalado, el hecho histórico no se borra; el cierre/regularización se registra aparte.
- La clasificación `EXTRAJUDICIAL` **no implica ejecución judicial, sentencia, embargo ni autorización de mecanismos de presión**. Es un estado de seguimiento interno y una eventual derivación a un responsable de recuperación. La cobranza efectiva fuera del sistema está excluida.
- No hay proceso especial `LIQUIDAR_DEUDA`; pagos posteriores se imputan de manera ordinaria y auditable.

## 5. Modelo relacional mínimo

| Entidad | Campos / requisitos fundamentales |
|---|---|
| `sucursales` | `id`, `codigo UNIQUE`, `nombre`, `estado` (sembrar solo sedes ratificadas). |
| `perfiles` | `auth_user_id`, `rol`, `sucursal_id`, `activo`. |
| `prestatarios` | `id`, `tipo=PERSONA_NATURAL/EMPRESA`, `estado`; identidad global del deudor. |
| `personas_naturales` | `prestatario_id`, `dni CHAR(8) UNIQUE`, nombres, apellidos, nacimiento, fecha validación, evidencia de vigencia verificable. |
| `empresas` | `prestatario_id`, `ruc CHAR(11) UNIQUE`, razón social, estado/condición RUC, fuente y fecha consulta. |
| `representantes_empresa` | `empresa_id`, `persona_id`, rol, autorización comprobada, fuente, fecha/actor. |
| `validaciones_identidad` | proveedor, resultado, correlación, fecha, actor y metadatos mínimos (sin payload íntegro). |
| `incidencias_identidad` | prestatario, valores protegidos antes/después, motivo, estado, autorizador, auditoría. |
| `prestamos` | `id`, `prestatario_id`, `sucursal_id`, `creado_por`, `principal`, `capital_insoluto`, `TEA`, `plazo_meses`, `estado`, `reserva_capital`, `idempotency_key`. |
| `cuotas` | `id`, `prestamo_id`, `numero`, `vencimiento`, `capital_programado`, `interes_programado`, `total_programado`, `estado_derivado`. |
| `desembolsos` | `prestamo_id UNIQUE`, importe, método, referencia, fecha, confirmó. |
| `pagos` | `id`, `prestamo_id`, monto, medio, estado, referencia, registra/confirma, fechas, idempotency_key UNIQUE`. |
| `pagos_imputaciones` | `pago_id`, `cuota_id`, `importe_capital`, `importe_interes`; soporta varios pagos/cuota y un pago/varias cuotas. |
| `eventos_mora` | `prestamo_id`, inicio_mora, fecha_fin, monto_vencido, evidencia de cronograma. |
| `expedientes_extrajudicial` | `prestamo_id`, `evento_mora_id`, fecha_escalamiento, estado, responsable, acción/resultado. |
| `auditoria` | actor, rol, sede, acción, entidad, fecha, correlación, resultado, metadatos mínimos. |

**Invariantes SQL:** `UNIQUE` DNI/RUC por tipo; FK; importes `NUMERIC(…,2)` positivos; `CHECK (plazo_meses BETWEEN 1 AND 60)`; tasa `0.30`; `UNIQUE(prestamo_id, numero)` de cuota; `UNIQUE(idempotency_key)` por transacción; pago e imputación deben conciliar. Bloqueo transaccional por prestatario, políticas RLS y funciones privilegiadas con validación explícita de identidad/sede.

**Estados separados, sin sobrecargar etiquetas:**

- Préstamo: `PENDIENTE_DESEMBOLSO`, `ACTIVO`, `PAGADO`, `ANULADO_SIN_DESEMBOLSO`. `EXTRAJUDICIAL` se representa como condición/expediente de cobranza, **no** sustituye el saldo del préstamo.
- Cuota: `PENDIENTE`, `PARCIAL`, `PAGADA`; `VENCIDA` es condición derivada por fecha y saldo, no reemplaza estado de pago.
- Pago: `REGISTRADO`, `PENDIENTE_VERIFICACION`, `CONFIRMADO`, `RECHAZADO`, `REVERSADO` mediante asiento compensatorio.
- Elegibilidad prestatario: `NUEVO/REGULAR` como clasificación; `MOROSO`, `EXTRAJUDICIAL`, `BLOQUEADO` como restricciones independientes, derivadas o auditadas.

## 6. Arquitectura y despliegue de costo objetivo S/ 0

| Componente | Opción elegida | Condición |
|---|---|---|
| Frontend | React + Vite + JavaScript en Cloudflare Pages | Plan Free y build desde GitHub. |
| Backend | Supabase Edge Functions (ecosistema JS/Deno) | HTTPS, autenticación, autorización y llamadas externas. |
| Datos | Supabase PostgreSQL | Transacciones SQL, RLS, índices, migraciones y registros de auditoría. |
| Sesiones | Supabase Auth | Rol/sede asociados al perfil controlado. |
| DNI | Scrall `reniec_basico` | Básico gratuito, **no ofrece caducidad**; límite anunciado 2 solicitudes/10 s. |
| RUC | Consulta pública SUNAT / fuente autorizada | Consulta web gratuita; **API automatizada gratuita no garantizada**. |
| Control de versiones | GitHub | Código fuente y CI cuando sea viable. |

**Objetivo económico:** S/ 0/mes **solo** dentro de cuotas gratuitas, sin dominio privado ni SLA, sujeto a condiciones de uso comerciales. No prometer operación 24/7, backups administrados ni verificación de DNI vigente automática a ese precio sin proveedor apto. Para créditos reales se exige exportación cifrada externa, restauración probada, seguridad y revisión de cumplimiento.

**Arquitectura:** repositorio único con frontend y Edge Functions; componentes desplegados separados pero aplicación integrada. No hay microservicios propios, servidor VPS, Kubernetes ni pasarela de pagos.

## 7. Marco Scrum

**Sprint Goal:** «Permitir a personal autorizado de sucursales identificar correctamente al prestatario, comprobar su elegibilidad y límite S/ 10 000, registrar préstamos TEA 30 % con plazo de 1 a 60 meses, generar cronograma, registrar cobranzas y reflejar mora/extrajudicial sin inconsistencia financiera».

**Artefactos:** Product Backlog con las historias siguientes; Sprint Backlog seleccionado por el equipo en Sprint Planning; Incremento integrado y ejecutable. Los puntos de historia **los estima el equipo** y no se igualan a horas ni se inventan para rellenar el informe.

**Eventos:** Sprint Planning para objetivo/selección/compromiso; Daily Scrum breve de inspección; Sprint Review mostrando software funcionando contra servicios reales donde sean requisito; Retrospective para mejora. Product Owner valida las reglas del profesor, Developers implementan y prueban, Scrum Master facilita impedimentos.

**Criterio del profesor:** el incremento se demuestra principalmente por su funcionamiento. La documentación operativa mínima necesaria para reproducir el despliegue y verificar seguridad **no** se convierte en un requisito de entregar una lista de tareas; el código y la evidencia observable siguen siendo obligatorios.

### 7.1 Historias de usuario y criterios de aceptación

**HU-01 — Autenticación y segregación por sucursales (P0).** Como empleado quiero acceder a las operaciones de mi sede y a la elegibilidad central sin poder alterar préstamos de otra sede.

- CA-01: usuarios activos autenticados, roles y sede derivados del backend; no del formulario.
- CA-02: un empleado de sede A no puede modificar préstamos de B; admin autorizado puede consultar información global.
- CA-03: cuentas/sedes inactivas no originan operaciones.

**HU-02 — Identidad de prestatarios naturales (P0).** Como asesor quiero ingresar DNI y recuperar nombre correcto sin digitación manual.

- CA-04: DNI 8 dígitos, consulta real a Scrall, mayoría de edad y `nuDni` coincidente.
- CA-05: un DNI corresponde a una ficha global; discrepancia de nombres bloquea nueva originación.
- CA-06: rechaza carné, pasaporte, extranjeros no domiciliados, errores del proveedor y documento no verificable como vigente. **La caducidad no está disponible en Scrall Básico; requisito pendiente de integración.**

**HU-03 — Identidad de empresa peruana (P0 funcional, condicionada a verificación).** Como asesor quiero registrar una empresa con RUC, razón social y representante acreditado.

- CA-07: RUC válido y único; razón social y estado ACTIVO/HABIDO cotejados con fuente SUNAT autorizada.
- CA-08: representante vinculado a DNI peruano y poder comprobado mediante proceso aprobado; sin eso se rechaza originación.
- CA-09: la deuda y el cupo pertenecen al RUC, no se mezclan con el DNI del representante.

**HU-04 — Elegibilidad crediticia y cupo global (P0).** Como asesor quiero visualizar el saldo de cupo real en todas las sedes antes de crear un préstamo.

- CA-10: el cupo se calcula sobre capital insoluto activo + reservas; rechaza superar S/ 10 000.
- CA-11: pagos confirmados liberan solo capital; mora/extrajudicial bloquean; segundo préstamo activo exige REGULAR.
- CA-12: pruebas concurrentes en dos sedes no exceden límite.

**HU-05 — Préstamo TEA 30 % y cronograma (P0).** Como asesor quiero registrar fecha, prestatario, monto y plazo y obtener cuotas válidas.

- CA-13: principal positivo sin mínimo comercial; plazo [1,60], TEA=30 %.
- CA-14: cronograma con fechas, desglose capital/interés, tasa y total, cálculo reproducible y redondeo exacto. **La TEA del 30 % queda invariable durante todo el contrato** y se conserva en los movimientos históricos.
- CA-15: alta y reserva son atómicas e idempotentes, sin deuda activa antes de confirmar desembolso.

**HU-06 — Confirmación de desembolso (P0).** Como cajero quiero activar un préstamo únicamente después de entregar el dinero.

- CA-16: conserva evidencia mínima de método, referencia, monto, actor, sede y fecha.
- CA-17: doble confirmación rechazada; anulación antes de desembolso libera reserva.

**HU-07 — Cobranza parcial y adelanto de cuotas (P0).** Como cajero quiero registrar pagos completos o parciales y cubrir cuotas futuras con intereses pactados.

- CA-18: abono positivo ≤ deuda programada pendiente, en orden de cuotas; permite primera cuota adelantada.
- CA-19: cuota `PARCIAL` hasta completar importe; `PAGADA` al llegar a cero; **adelantar cuotas no altera ni la TEA fija del 30 % ni el interés programado de cada cuota**, incluso cuando se paguen antes de su vencimiento.
- CA-20: pago confirmado se distribuye a capital/interés; únicamente capital amortizado libera cupo; transferencia sin verificar no altera saldo.
- CA-21: varios abonos por cuota, sin duplicidad, doble cobro, importe negativo ni desbordar la deuda.

**HU-08 — Mora y expediente extrajudicial (P0).** Como supervisor quiero saber qué clientes incumplieron vencimientos y quién alcanzó un año de mora.

- CA-22: al día siguiente de cuota vencida con saldo positivo, `MOROSO` bloquea crédito en todas las sedes.
- CA-23: un año calendario de mora continua genera un solo escalamiento/expediente EXTRAJUDICIAL por racha; sin borrado del histórico.
- CA-24: abonos posteriores se registran; el sistema no elimina deuda por pasar a extrajudicial ni tiene función `LIQUIDAR_DEUDA`.

**HU-09 — Consultas e historial global (P0).** Como usuario quiero encontrar al prestatario por DNI o RUC y consultar la situación consolidada.

- CA-25: muestra préstamos, sede, fechas, principal, plazo, tasa, cuotas, pagos confirmados y saldo exacto.
- CA-26: muestra cupo global disponible y motivo de bloqueo, con detalle limitado por permisos.
- CA-27: el historial de pagos y expediente extrajudicial es inmutable/auditable.

**HU-10 — Control de operaciones y auditoría (P0).** Como administrador quiero poder detectar errores de registro y accesos indebidos.

- CA-28: conserva actor, sede, fecha, operación, idempotencia y correlación de registro de crédito/cobro.
- CA-29: pagos confirmados no se borran; correcciones controladas no destruyen trazabilidad.
- CA-30: RLS y secretos protegidos; respaldo de datos y restauración verificables antes de uso real.

### 7.2 Definición de Preparado (DoR)

Una historia está lista cuando actores, política aplicable, datos, criterios y dependencias son verificables. **Señales bloqueantes**: no existe fuente que permita comprobar vigencia de DNI, no se ha validado la autoridad del representante, no se ha aprobado la convención financiera o no se ha confirmado el procedimiento de pago anticipado conforme a la ley aplicable. Esas carencias no se sustituyen inventando resultados.

### 7.3 Definición de Terminado (DoD)

- Flujo ejecutable extremo a extremo integrado y desplegado por personal autorizado.
- Validaciones reales de proveedor exigido; datos simulados solo en pruebas unitarias/QA, nunca como sustituto de verificación para otorgar créditos.
- Cálculos y estados exactos, pruebas de límites, concurrencia, errores y autorización.
- Operaciones persistidas con atomicidad, idempotencia, auditoría y control de permisos.
- Sprint Review: el Product Owner inspecciona el **software funcionando**, no una presentación de tareas.
- No declarar funcionalidad «apta para producción» si falta un requisito bloqueante (vigencia, autoridad, derechos de prepago, continuidad o protección de datos).

## 8. Casos de aceptación esenciales

| ID | Caso | Resultado esperado |
|---|---|---|
| CP-01 | DNI coincide con Scrall real y edad adulta | Crea/reutiliza ficha sin transcribir nombres. |
| CP-02 | DNI correcto de formato pero documento de vigencia no comprobable | No afirma «vigente» ni origina hasta controlar requisito. |
| CP-03 | DNI no encontrado, respuesta errónea, 429 | Falla cerrada. |
| CP-04 | DNI existente con nombre discordante | Bloqueo y corrección autorizada; sin duplicar. |
| CP-05 | Se intenta registrar extranjero con carné o pasaporte | Rechazado. |
| CP-06 | Empresa con RUC activo/habido y representante autorizado | Registro empresarial válido, sin mezclar historial personal. |
| CP-07 | RUC inactivo o representante no comprobado | No origina. |
| CP-08 | Plazo 0 y 61 meses | Rechazo; 1 y 60 aceptados. |
| CP-09 | Principal cero, negativo y S/ 0.01 | Rechaza ≤0; no añade mínimo comercial adicional. |
| CP-10 | Verificación de TEA 30 % en distintos plazos | Tasa periódica, capital/interés y cronograma coherentes. |
| CP-11 | Exposición de S/ 10 000 | Cupo S/ 0; nueva solicitud rechazada. |
| CP-12 | Pago libera S/ 5 000 de capital, sin intereses confundidos | Cupo S/ 5 000, con demás condiciones satisfechas. |
| CP-13 | Pago de S/ 5 000 incluye intereses | Cupo sube solo por capital realmente amortizado. |
| CP-14 | Cliente MOROSO con cupo libre solicita préstamo | Rechazado. |
| CP-15 | Cliente en EXTRAJUDICIAL solicita préstamo | Rechazado. |
| CP-16 | Dos sedes reservan simultáneamente capital | No supera S/ 10 000. |
| CP-17 | Dos abonos parciales a misma cuota | Saldo exacto, historial de ambos, cuota pagada solo al completar. |
| CP-18 | Primera cuota pagada antes de vencimiento | Pagada, interés de esa cuota conservado. |
| CP-19 | Pago adelanta varias cuotas futuras | Se mantienen **TEA 30 %**, importes, interés programado y desglose original; no se genera nuevo cronograma. |
| CP-19A | Comparar cronograma antes y después de adelantar cuotas | La tasa se mantiene exactamente en **30 % TEA**; no se modifica ningún interés programado por el adelanto y se registra qué cuotas quedaron cubiertas. |
| CP-20 | Transferencia no confirmada | No reduce saldo ni libera cupo. |
| CP-21 | Cuota vence hoy y queda impaga | Todavía no moroso por esa cuota durante día de vencimiento. |
| CP-22 | Cuota quedó impaga al día siguiente | MOROSO y bloqueo central. |
| CP-23 | Mora continua por un año calendario | Expediente EXTRAJUDICIAL creado una sola vez. |
| CP-24 | Se regulariza la cuota morosa antes del año | Se cierra racha y no se escala por ella. |
| CP-25 | Deuda entra en EXTRAJUDICIAL | Saldo no desaparece ni se crea operación «liquidar». |
| CP-26 | Se pagan todas las cuotas programadas | Préstamo `PAGADO` automáticamente, con historial preservado. |
| CP-27 | Empleado intenta modificar otra sucursal | Bloqueado en API/SQL. |
| CP-28 | Reenvío del mismo pago | Una sola confirmación y asignación. |
| CP-29 | Cuenta o sede inactiva intenta préstamo | Acceso/operación rechazada. |
| CP-30 | Scrum Review del MVP | Flujo reproducible funcionando; sin necesidad de presentar lista de tareas. |

## 9. Diferencias con v1.2 y decisiones por confirmar

### 9.1 Modificaciones obligatorias respecto de v1.2

| Sección antigua | Nueva decisión |
|---|---|
| Portada y resumen: 3 sucursales | Sedes configurables; cinco nombres mencionados, lista provisional. |
| RN-06: «30 % anual por definir TEA/TNA» | **30 % TEA fija durante toda la vigencia**, sin cambio por adelanto de cuotas; método de amortización sigue por aprobar. |
| Gracia configurable (v1.1) | Interpretación actual: mora **tras vencimiento**, sin gracia extra. |
| v1.2: préstamo `LIQUIDADO` | `PAGADO` por cumplimiento de cuotas; **sin operación especial liquidar**. |
| Adenda v1.2: pagos que liberan capital | Se conserva estrictamente la **porción capital**, no el importe total cobrado. |
| v2 anterior: prepago extraordinario de capital y recálculo | **Excluido como funcionalidad elegida para el MVP**; no confundir con derechos legalmente exigibles. |
| Solo cliente natural con DNI | Dos tipos: persona peruana por DNI y empresa peruana por RUC. |
| Periodo/plazo indefinido | 1–60 meses y registro de fecha/monto/plazo. |
| Plan T01–T15 y evidencias documentales extensas | Backlog de HU, eventos Scrum, criterios y prueba de funcionamiento. |

### 9.2 Riesgos y decisiones pendientes (no inventar)

| ID | Decisión / brecha | Efecto |
|---|---|---|
| B-01 | **DNI vigente:** Scrall Básico no entrega caducidad. Confirmar fuente autorizada verificable, costo y flujo. | **Bloquea declarar validación automática de DNI vigente**. |
| B-02 | **Cobranza legal:** distinguir adelanto de cuotas de derecho al prepago de capital cuando la norma corresponda. | No bloquear ilegalmente derecho del consumidor ni prometer cobro íntegro de intereses no devengados en cualquier caso. |
| B-03 | **«30 días»:** ¿cuotas a intervalos de 30 días o gracia de 30 días antes de mora? Aquí se interpretó **cuota exigible y mora desde día siguiente**. | Cambia vencimientos, elegibilidad y año de mora. |
| B-04 | **Amortización:** método francés y mes calendario son **propuesta técnica**, aunque la TEA sí está aprobada. | Afecta todos los importes por cuota. |
| B-05 | **REGULAR:** cantidad de préstamos íntegramente atendidos y criterios de historial por ratificar. | Cambia permiso de multipréstamo. |
| B-06 | **Sedes:** confirmar Chimbote, Chiclayo, Trujillo, Tumbes y Piura; cantidad final. | Evita sembrar sucursales inexistentes. |
| B-07 | **Empresa:** comprobar RUC y facultad de representación con mecanismo aceptado; la búsqueda web gratis no es certificación automática de poderes. | Bloquea crédito empresarial no verificado. |
| B-08 | **Extrajudicial:** confirmar responsable y definición administrativa de apertura/cierre de expediente. | No puede sustituirse por proceso judicial automático. |
| B-09 | **Costo cero comercial:** cuotas/condiciones de Scrall y garantías limitadas de Supabase Free. | Requiere decisión operativa y respaldo independiente. |

### 9.3 Cambio aprobado en la versión 1.4

El profesor precisó que **«el interés nunca cambia»**. Esta condición se incorpora a RN-06 y RN-41, HU-05/CA-14, HU-07/CA-19 y CP-19/CP-19A: la **TEA se mantiene en 30 % durante el préstamo** y adelantar cuotas programadas **no altera los intereses ya pactados** para esas cuotas. Se conservan, por separado, la amortización ordinaria de capital que libera cupo y la salvedad sobre derechos legales de prepago de capital.

## 10. Fuentes y enlaces

**Documentales:** `Sprint1_Prestamos(2).docx` (16/10/2026) y `Plan_Sprint1_MVP_Prestamos_Multisucursal_v1.2.pdf` (27 páginas, versión base y adendas 1.1–1.2). Las reglas nuevas se atribuyen a la solicitud del profesor comunicada el 18/10/2026 y no al PDF antiguo.

**Fuentes públicas de contraste (no sustituyen validación contractual/legal):**

- [Scrall — RENIEC Básico](https://www.scrall.net/apis/reniec_basico) y [comparación Básico/Intermedio: vigencia](https://scrall.net/productos/api-reniec-dni).
- [RENIEC — consulta de vigencia del DNI](https://identidad.reniec.gob.pe/b/elecciones-2026-revisa-la-vigencia-del-dni-los-tramites-y-costos-de-renovacion).
- [SUNAT — consulta oficial de RUC](https://www.gob.pe/565-consultar-el-estado-del-ruc).
- [Código de Protección y Defensa del Consumidor — artículo 86](https://busquedas.elperuano.pe/dispositivo/NL/538113-1).
- [SBS — adelanto de cuotas versus pago anticipado](https://www.sbs.gob.pe/Portals/0/jer/SF_CCA/RESOLUCION_6566-2015.pdf).
- [Supabase — precios](https://supabase.com/pricing) y [Cloudflare Pages — límites](https://developers.cloudflare.com/pages/platform/limits/).

