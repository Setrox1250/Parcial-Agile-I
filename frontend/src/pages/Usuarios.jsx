import { useCallback, useEffect, useState } from 'react'
import { llamarFuncion, supabase } from '../services/supabase'

const FORM_VACIO = {
  email: '',
  password: '',
  nombre_visible: '',
  rol: 'SUPERVISOR_FINANCIERO',
  sucursal_id: '',
}

export default function Usuarios() {
  const [perfiles, setPerfiles] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [form, setForm] = useState(FORM_VACIO)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const { perfiles: lista } = await llamarFuncion('usuarios')
      setPerfiles(lista)
      const { data: sedes, error: errorSedes } = await supabase
        .from('sucursales')
        .select('id, codigo, nombre')
        .eq('estado', 'ACTIVA')
        .order('nombre')
      if (errorSedes) throw new Error(errorSedes.message)
      setSucursales(sedes)
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cambiar = (campo) => (e) => setForm({ ...form, [campo]: e.target.value })

  const crear = async (e) => {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    setEnviando(true)
    try {
      await llamarFuncion('usuarios', {
        method: 'POST',
        body: {
          email: form.email.trim(),
          password: form.password,
          nombre_visible: form.nombre_visible.trim(),
          rol: form.rol,
          sucursal_id: form.sucursal_id || null,
        },
      })
      setMensaje('Usuario creado correctamente')
      setForm(FORM_VACIO)
      await cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  const alternarActivo = async (perfil) => {
    setError(null)
    setMensaje(null)
    try {
      await llamarFuncion('usuarios', {
        method: 'PATCH',
        path: `/${perfil.id}`,
        body: { activo: !perfil.activo },
      })
      setMensaje(`${perfil.nombre_visible} ${perfil.activo ? 'desactivado' : 'activado'}`)
      await cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section>
      <h1>Usuarios</h1>

      {error && <div className="aviso aviso-error">{error}</div>}
      {mensaje && <div className="aviso aviso-ok">{mensaje}</div>}

      <div className="tarjeta">
        <h2>Crear usuario</h2>
        <form className="formulario" onSubmit={crear}>
          <label>
            Nombre
            <input
              type="text"
              value={form.nombre_visible}
              onChange={cambiar('nombre_visible')}
              required
            />
          </label>
          <label>
            Correo
            <input type="email" value={form.email} onChange={cambiar('email')} required />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={form.password}
              onChange={cambiar('password')}
              minLength={8}
              required
            />
          </label>
          <label>
            Rol
            <select value={form.rol} onChange={cambiar('rol')}>
              <option value="SUPERVISOR_FINANCIERO">Supervisor financiero</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </label>
          <label>
            Sucursal {form.rol === 'SUPERVISOR_FINANCIERO' ? '(obligatoria)' : '(opcional)'}
            <select value={form.sucursal_id} onChange={cambiar('sucursal_id')}>
              <option value="">— Ninguna —</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} ({s.codigo})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear usuario'}
          </button>
        </form>
      </div>

      <div className="tarjeta">
        <h2>Listado</h2>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {perfiles.map((p) => (
                <tr key={p.id} className={p.activo ? '' : 'fila-inactiva'}>
                  <td>{p.nombre_visible}</td>
                  <td>{p.email ?? '—'}</td>
                  <td>{p.rol}</td>
                  <td>{p.sucursal_nombre ?? '—'}</td>
                  <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secundario"
                      onClick={() => alternarActivo(p)}
                    >
                      {p.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
