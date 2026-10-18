import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, llamarFuncion } from '../services/supabase'

const AuthContext = createContext(null)

// La sesión viene de Supabase Auth; el rol y la sucursal SIEMPRE desde
// la Edge Function quien-soy (CA-01: nunca desde el formulario).
export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorSesion, setErrorSesion] = useState(null)

  const cargarPerfil = useCallback(async () => {
    try {
      const data = await llamarFuncion('quien-soy')
      setUsuario(data.usuario)
      setErrorSesion(null)
    } catch (e) {
      setUsuario(null)
      setErrorSesion(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    let cancelado = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelado) return
      if (session) {
        cargarPerfil()
      } else {
        setUsuario(null)
        setCargando(false)
      }
    })

    const { data: suscripcion } = supabase.auth.onAuthStateChange((evento) => {
      if (cancelado) return
      if (evento === 'SIGNED_IN') {
        setCargando(true)
        cargarPerfil()
      } else if (evento === 'SIGNED_OUT') {
        setUsuario(null)
        setCargando(false)
      }
    })

    return () => {
      cancelado = true
      suscripcion.subscription.unsubscribe()
    }
  }, [cargarPerfil])

  const entrar = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error('Credenciales inválidas')
  }, [])

  const salir = useCallback(async () => {
    await supabase.auth.signOut()
    setUsuario(null)
  }, [])

  const valor = useMemo(
    () => ({ usuario, cargando, errorSesion, entrar, salir, recargarPerfil: cargarPerfil }),
    [usuario, cargando, errorSesion, entrar, salir, cargarPerfil],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
