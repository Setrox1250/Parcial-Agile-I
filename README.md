# Parcial-Agile-I — Sistema de Préstamos Multisucursal

MVP del Sistema de Préstamos Multisucursal (Sprint 01). Especificación funcional: `SPRINT_01_PRESTAMOS_MULTISUCURSAL_v1.4.md`.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + JavaScript |
| Backend | Java 21 + Spring Boot (Maven) |
| Base de datos | PostgreSQL |
| Control de versiones | GitHub |

## Estructura del proyecto

```
.
├── frontend/          # React + Vite (JavaScript)
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/  # Cliente HTTP hacia el backend
│       └── utils/
├── backend/           # Spring Boot (Java)
│   └── src/main/java/com/prestamos/backend/
│       ├── config/
│       ├── controllers/
│       ├── services/
│       ├── repositories/
│       ├── models/
│       ├── dto/
│       └── exceptions/
└── SPRINT_01_PRESTAMOS_MULTISUCURSAL_v1.4.md
```

## Ejecución local

### Backend (puerto 8080)

```bash
cd backend
./mvnw spring-boot:run
```

Requiere una base de datos PostgreSQL (ver `backend/src/main/resources/application.properties`).

### Frontend (puerto 5173)

```bash
cd frontend
npm install
npm run dev
```

## Notas

- TEA fija 30 %, plazo 1–60 meses, cupo global S/ 10 000 por prestatario (DNI o RUC).
- Aún no se ha implementado funcionalidad de historias de usuario: solo estructura base.
