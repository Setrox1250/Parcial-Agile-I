import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

// Llamada autenticada a una Edge Function con el JWT de la sesión actual.
export async function llamarFuncion(nombre, { method = 'GET', path = '', body } = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token

  const respuesta = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nombre}${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  )

  const json = await respuesta.json().catch(() => ({}))
  if (!respuesta.ok) {
    throw new Error(json?.error?.message ?? 'Error inesperado del servidor')
  }
  return json
}
