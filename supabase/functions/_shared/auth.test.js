// Pruebas unitarias de los helpers de autorización (HU-01, 1.10.4 / CA-01).
// Ejecutar: deno test supabase/functions/_shared/

import { requireRole, assertSucursalPropia } from "./auth.js";

const supervisor = {
  auth_user_id: "00000000-0000-0000-0000-000000000001",
  nombre_visible: "Supervisor",
  rol: "SUPERVISOR_FINANCIERO",
  sucursal_id: "suc-1",
  activo: true,
};

const admin = { ...supervisor, rol: "ADMIN", sucursal_id: null };

Deno.test("requireRole permite cuando el rol está en la lista", () => {
  const error = requireRole(supervisor, ["SUPERVISOR_FINANCIERO"]);
  if (error !== null) {
    throw new Error(`esperaba null, obtuve ${error}`);
  }
});

Deno.test("requireRole rechaza rol no permitido con 403", () => {
  const error = requireRole(supervisor, ["ADMIN"]);
  if (!(error instanceof Response)) throw new Error("esperaba una Response de error");
  if (error.status !== 403) throw new Error(`esperaba 403, obtuve ${error.status}`);
});

Deno.test("requireRole rechaza roles fuera del catálogo (CAJERO no existe)", () => {
  const error = requireRole({ ...supervisor, rol: "CAJERO" }, [
    "ADMIN",
    "SUPERVISOR_FINANCIERO",
  ]);
  if (!(error instanceof Response) || error.status !== 403) {
    throw new Error("esperaba 403 para un rol fuera del catálogo");
  }
});

Deno.test("assertSucursalPropia permite al ADMIN operar en cualquier sede", () => {
  const error = assertSucursalPropia(admin, "suc-2");
  if (error !== null) throw new Error(`esperaba null, obtuve ${error}`);
});

Deno.test("assertSucursalPropia permite al supervisor su propia sede (RN-30)", () => {
  const error = assertSucursalPropia(supervisor, "suc-1");
  if (error !== null) throw new Error(`esperaba null, obtuve ${error}`);
});

Deno.test("assertSucursalPropia bloquea al supervisor en sede ajena (RN-30, CA-02)", () => {
  const error = assertSucursalPropia(supervisor, "suc-2");
  if (!(error instanceof Response)) throw new Error("esperaba una Response de error");
  if (error.status !== 403) throw new Error(`esperaba 403, obtuve ${error.status}`);
});
