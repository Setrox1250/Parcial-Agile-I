import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute, RequireRole } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Inicio from './pages/Inicio'
import Login from './pages/Login'
import Usuarios from './pages/Usuarios'
import IdentidadPrestatarioPage from './pages/identidad/IdentidadPrestatarioPage'
import EmpresaPage from './pages/empresa/EmpresaPage'
import DesembolsosPage from './pages/desembolsos/DesembolsosPage'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Inicio />} />
          <Route path="/identidad" element={<IdentidadPrestatarioPage />} />
          <Route path="/empresa" element={<EmpresaPage />} />
          <Route
            path="/desembolsos"
            element={
              <RequireRole roles={['ADMIN', 'SUPERVISOR_FINANCIERO']}>
                <DesembolsosPage />
              </RequireRole>
            }
          />
          <Route
            path="/usuarios"
            element={
              <RequireRole roles={['ADMIN']}>
                <Usuarios />
              </RequireRole>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
