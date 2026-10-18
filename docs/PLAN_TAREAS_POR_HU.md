# Plan de tareas por Historia de Usuario — Sprint 01

**Sistema de Préstamos Multisucursal · MVP Sprint 01**

- **Stack:** React + Vite + JavaScript (frontend) · Supabase Edge Functions Deno/JS (backend) · Supabase PostgreSQL + Auth
- **Base:** especificación `SPRINT_01_PRESTAMOS_MULTISUCURSAL_v1.4.md` (reglas RN-01..RN-41, criterios CA-01..CA-30)
- **Convención:** cada tarea agrupa subtareas ejecutables; `[DB]` = migración SQL, `[EF]` = Edge Function, `[FE]` = frontend, `[TEST]` = pruebas

## Alcance (restricciones)

- Solo se admite **persona natural peruana con DNI** (8 dígitos).
- Solo se admite **empresa peruana con RUC** (11 dígitos).
- **No** se admiten extranjeros, carné de extranjería, pasaporte, VISA ni ningún otro tipo de documento de identidad extranjero.
- **Moneda:** únicamente **Soles (PEN)** para todos los importes (principal, cuotas, pagos, cupo).
- Las validaciones son estrictas: **solo DNI y RUC peruanos**. Cualquier otro documento se rechaza de forma explícita.

## Roles del sistema
