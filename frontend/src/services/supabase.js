import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

// Llamada autenticada a una Edge Function con el JWT de la sesión actual.
export async function llamarFuncion(nombre, { method = 'GET', path = '', body } = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  const correlationId = crypto.randomUUID()

  const respuesta = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${nombre}${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  )

  const json = await respuesta.json().catch(() => ({}))
  if (!respuesta.ok) {
    const error = new Error(json?.error?.message ?? 'Error inesperado del servidor')
    // Conserva el error tipificado del backend para consumidores que lo necesiten.
    error.status = respuesta.status
    error.payload = json?.error ?? json
    error.correlationId = correlationId
    error.message = `${error.message} (Código de soporte: ${correlationId})`
    throw error
  }
  return json
}
