import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import './App.css'

const Home = lazy(() => import('./pages/Home'))
const Room = lazy(() => import('./pages/Room'))
const Highlights = lazy(() => import('./pages/Highlights'))
const HighlightsAll = lazy(() => import('./pages/HighlightsAll'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function App() {
  return (
    <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <ProtectedRoute>
              <Room />
            </ProtectedRoute>
          }
        />
        <Route
          path="/room/:roomId/highlights"
          element={
            <ProtectedRoute>
              <Highlights />
            </ProtectedRoute>
          }
        />
        <Route
          path="/highlights"
          element={
            <ProtectedRoute>
              <HighlightsAll />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Suspense>
  )
}

export default App
