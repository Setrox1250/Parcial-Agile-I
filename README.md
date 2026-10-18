# Parcial-Agile-I — Sistema de Préstamos Multisucursal

MVP del Sistema de Préstamos Multisucursal (Sprint 01).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + JavaScript |
| Backend | Supabase Edge Functions (Deno/JS) |
| Datos | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Identidad DNI | Scrall `reniec_basico` |
| Control de versiones | GitHub |

## Estructura del proyecto

```
.
├── frontend/                  # React + Vite (JavaScript)
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/          # Cliente HTTP / Supabase JS
│       └── utils/
├── supabase/
│   ├── config.toml            # Configuración del Supabase CLI
│   ├── functions/             # Edge Functions (Deno/JS)
│   │   ├── _shared/           # CORS, respuestas, cliente admin, auth (rol/sucursal)
│   │   └── health/            # Plantilla + verificación de despliegue
│   └── migrations/            # Migraciones SQL
├── .github/workflows/
│   ├── ci.yml                 # Lint + build frontend + chequeo Deno de funciones
│   └── deploy-supabase.yml    # Despliegue automático de funciones en push a main
└── docs/                      # Especificación (no versionada)
```

## Ejecución local

### Frontend (puerto 5173)

```bash
cd frontend
npm install
cp ../.env.example .env   # completar con los valores de tu proyecto Supabase
npm run dev
```

### Edge Functions

Requiere el [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase start            # stack local (Postgres + Auth + functions)
supabase functions serve  # sirve funciones en http://localhost:54321/functions/v1/*
curl http://localhost:54321/functions/v1/health
```

## Despliegue (Supabase CLI)

### Una vez por proyecto

1. Crear proyecto en supabase.com y obtener el **Reference ID** (Project Settings → General).
2. Crear un [Access Token](https://supabase.com/dashboard/account/tokens).
3. Configurar secrets en GitHub (Settings → Secrets and variables → Actions):
   - `SUPABASE_ACCESS_TOKEN`
   - `SUPABASE_PROJECT_REF`
4. Crear el environment `supabase` en el repo (Settings → Environments).
5. Setear secrets de funciones (ej. Scrall):

```bash
supabase secrets set SCRALL_API_KEY=... --project-ref TU-REF
```

### Despliegue automático

Al hacer push a `main` que cambie `supabase/functions/**`, el workflow
`deploy-supabase.yml` ejecuta `supabase functions deploy` con el project-ref configurado.
También puede lanzarse manualmente desde la pestaña Actions (`workflow_dispatch`).

### Despliegue manual

```bash
supabase link --project-ref TU-REF
supabase functions deploy health --project-ref TU-REF
supabase functions deploy                     # todas las funciones
```

## Notas

- TEA fija 30 %, plazo 1–60 meses, cupo global S/ 10 000 por prestatario (DNI o RUC).
- Roles: solo `ADMIN` y `SUPERVISOR_FINANCIERO` (este último origina préstamos).
- Las reglas de negocio críticas se validan en backend/BD, nunca solo en el navegador.
- Aún no se ha implementado funcionalidad de historias de usuario: solo estructura base.
