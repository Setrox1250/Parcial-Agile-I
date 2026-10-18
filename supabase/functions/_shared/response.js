import { corsHeaders } from "./cors.js";

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorResponse(message, status = 400, code = "ERROR", extra = {}) {
  return json({ error: { code, message, ...extra } }, status);
}
