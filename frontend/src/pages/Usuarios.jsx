import { useCallback, useEffect, useState } from 'react'
import { llamarFuncion, supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import TablaDatos from '../components/ui/TablaDatos.jsx'

const FORM_VACIO = {
  email: '',
  password: '',
  nombre_visible: '',
  rol: 'SUPERVISOR_FINANCIERO',
  sucursal_id: '',
}

export default function Usuarios() {
  const { usuario } = useAuth()
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
    <section className="modulo-operativo">
      <header className="modulo-cabecera">
        <div>
          <p className="modulo-eyebrow">ADMINISTRACIÓN</p>
          <h1>Usuarios y accesos</h1>
          <p>Administra quién puede operar y el ámbito de sucursal asignado a cada perfil.</p>
        </div>
        <span className="modulo-contador">{perfiles.length} usuarios</span>
      </header>

      {error && <div className="aviso aviso-error">{error}</div>}
      {mensaje && <div className="aviso aviso-ok">{mensaje}</div>}

      <div className="tarjeta filtros-operativos">
        <p className="tarjeta-eyebrow">NUEVO ACCESO</p>
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

      <div className="tarjeta cola-operativa">
        <div className="cola-operativa-cabecera"><div><p className="tarjeta-eyebrow">DIRECTORIO</p><h2>Usuarios registrados</h2></div><span>Activa o suspende el acceso</span></div>
        {cargando ? (
          <p className="cargando">Cargando…</p>
        ) : (
          <TablaDatos
            filas={perfiles}
            columnas={['Nombre', 'Correo', 'Rol', 'Sucursal', 'Estado', 'Acciones']}
            clave={(p) => p.id}
            buscarEn={(p) => `${p.nombre_visible ?? ''} ${p.email ?? ''} ${p.rol ?? ''} ${p.sucursal_nombre ?? ''}`}
            filtros={[
              { id: 'estado', etiqueta: 'Estado', opciones: [{ valor: 'activo', etiqueta: 'Activo' }, { valor: 'inactivo', etiqueta: 'Inactivo' }], coincide: (p, valor) => (valor === 'activo' ? p.activo : !p.activo) },
              { id: 'rol', etiqueta: 'Rol', opciones: [...new Set(perfiles.map((p) => p.rol).filter(Boolean))].map((valor) => ({ valor, etiqueta: valor })), coincide: (p, valor) => p.rol === valor },
            ]}
            renderFila={(p) => (
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
                      disabled={p.activo && p.auth_user_id === usuario?.auth_user_id}
                      title={p.activo && p.auth_user_id === usuario?.auth_user_id
                        ? 'No puede desactivar su propio usuario'
                        : undefined}
                    >
                      {p.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
            )}
          />
        )}
      </div>
    </section>
  )
}
