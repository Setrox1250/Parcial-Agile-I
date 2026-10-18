import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute, RequireRole } from './components/ProtectedRoute'
import Layout from './components/Layout'
import Inicio from './pages/Inicio'
import Login from './pages/Login'
import Usuarios from './pages/Usuarios'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Inicio />} />
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
