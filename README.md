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
│   ├── config.toml
│   ├── functions/             # Edge Functions (Deno/JS)
│   │   └── _shared/           # Utilidades compartidas (CORS, clientes)
│   └── migrations/            # Migraciones SQL
└── docs/                      # Especificación (no versionada)
```

## Ejecución local

### Frontend (puerto 5173)

```bash
cd frontend
npm install
npm run dev
```

### Edge Functions

Requiere el [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase start          # stack local (Postgres + Auth +.functions)
supabase functions serve
```

## Notas

- TEA fija 30 %, plazo 1–60 meses, cupo global S/ 10 000 por prestatario (DNI o RUC).
- Las reglas de negocio críticas se validan en backend/BD, nunca solo en el navegador.
- Aún no se ha implementado funcionalidad de historias de usuario: solo estructura base.
