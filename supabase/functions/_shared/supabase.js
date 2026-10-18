import { createClient } from "npm:@supabase/supabase-js@2";

// Cliente con service role: SOLO dentro de Edge Functions, nunca en el frontend.
export function createAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Cliente con la anon key: solo para validar el JWT del request.
export function createAnonClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
