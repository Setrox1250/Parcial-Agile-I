## Cómo usar los agentes (skills para agentes) en Opencode

Opencode carga los archivos `.opencode/agents/*.md` del proyecto automáticamente como **subagentes**.
Se invocan con la herramienta `task` (no se llaman desde CLI con un comando, se usan dentro de una conversación).

### Sintaxis (tool call `task`)

```json
{
  "tool": "task",
  "description": "Crear migraciones de Fase 0 (HU-01 base de datos)",
  "prompt": "Usa el plan docs/PLAN_TAREAS_POR_HU.md. Crea las migraciones 0.5.1–0.5.2 de perfiles/sucursales según reglas: solo DNI/RUC peruanos, PEN, RLS, constraints y FOR UPDATE para serializar por prestatario. Genera archivos en supabase/migrations/ con timestamp secuencial.",
  "subagent_type": "db-engineer"
}
```

### Casos de uso para Fase 0

1. **Completar migraciones + RLS (Issue #1, tareas 0.5–0.6)**
   - `subagent_type`: `db-engineer`
   - Prompt: pide crear migraciones `supabase/migrations/` con RLS, políticas por rol (ADMIN/SUPERVISOR_FINANCIERO), funciones SECURITY DEFINER

2. **Crear/ajustar Edge Functions base (auth, quien-soy)**
   - `subagent_type`: `supabase-functions`
   - Prompt: implementar `supabase/functions/quien-soy/index.js` usando `_shared/auth.js`, validar solo roles permitidos, RN-30

3. **Validar cobertura vs spec antes de cerrar HU**
   - `subagent_type`: `spec-validator`
   - Prompt: revisa lo implementado para HU-01 vs docs/SPRINT_01_PRESTAMOS_MULTISUCURSAL_v1.4.md y PLAN_TAREAS_POR_HU.md. Devuelve CUBIERTO/FALTA/BLOQUEANTE con IDs RN/CA/CP

4. **Probar casos borde/concurrencia**
   - `subagent_type`: `qa-borde`
   - Prompt: valida CP críticos (CP-16 concurrencia 2 sedes, CP-11 cupo 10000 exacto, idempotencia CP-28)

5. **Auditoría de seguridad**
   - `subagent_type`: `security-auditor`
   - Prompt: revisa migraciones+EF. Verifica RLS, sin service_role en frontend, solo DNI/RUC peruanos, PEN, RN-33/RN-34

### Tips
- Los agentes están en `.opencode/agents/` → se detectan automáticamente al entrar al proyecto `/home/setrox/Projects/University/Parcial-Agile`
- Usa `mode: subagent` (ya lo tienen). Opencode los invoca con `task.subagent_type = <nombre>`
- Sé específico en el `prompt`: incluye rutas, archivos, IDs de tareas/issues y restricciones (solo peruanos, PEN)
- Para empezar Fase 0: pide a `db-engineer` las migraciones 0.5.1–0.5.4 primero (base de datos), luego `supabase-functions` para auth (1.3–1.5)
