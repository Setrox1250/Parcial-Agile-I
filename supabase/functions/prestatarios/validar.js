// HU-09: validación de búsqueda y parámetros de historial (RN-01/RN-35).
import { esRucValido } from "../_shared/ruc.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DNI_RE = /^[0-9]{8}$/;

export function esUuid(valor) {
  return typeof valor === "string" && UUID_RE.test(valor);
}

// GET /prestatarios/buscar?dni= | ?ruc= — exactamente uno de los dos (RN-01).
export function parsearBusqueda(searchParams) {
  const dni = searchParams.get("dni");
  const ruc = searchParams.get("ruc");

  const tieneDni = dni !== null && dni !== "";
  const tieneRuc = ruc !== null && ruc !== "";

  if (tieneDni === tieneRuc) {
    return {
      tipo: null,
      valor: null,
      error: "Indique exactamente un documento: ?dni=XXXXXXXX o ?ruc=XXXXXXXXXXX.",
    };
  }

  if (tieneDni) {
    if (!DNI_RE.test(dni)) {
      return { tipo: null, valor: null, error: "El DNI debe tener exactamente 8 dígitos." };
    }
    return { tipo: "dni", valor: dni, error: null };
  }

  if (!esRucValido(ruc)) {
    return {
      tipo: null,
      valor: null,
      error: "El RUC debe tener 11 dígitos con dígito verificador válido.",
    };
  }
  return { tipo: "ruc", valor: ruc, error: null };
}

// GET /prestatarios/<uuid>/historial
export function parsearRutaHistorial(pathname) {
  // El gateway entrega la ruta completa (/functions/v1/prestatarios/<uuid>/historial):
  // se validan los dos últimos segmentos y se ignora el prefijo.
  const partes = pathname.split("/").filter(Boolean);
  const longitud = partes.length;
  if (
    longitud >= 2 &&
    partes[longitud - 1] === "historial" &&
    esUuid(partes[longitud - 2])
  ) {
    return { prestatarioId: partes[longitud - 2], error: null };
  }
  return {
    prestatarioId: null,
    error: "Ruta inválida: use GET /prestatarios/buscar?dni=|ruc= o GET /prestatarios/<uuid>/historial.",
  };
}
