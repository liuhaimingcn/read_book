import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'

const Home = lazy(() => import('./pages/Home'))
const Room = lazy(() => import('./pages/Room'))
const Highlights = lazy(() => import('./pages/Highlights'))
const HighlightsAll = lazy(() => import('./pages/HighlightsAll'))

function App() {
  return (
    <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="/room/:roomId/highlights" element={<Highlights />} />
        <Route path="/highlights" element={<HighlightsAll />} />
      </Routes>
    </Suspense>
  )
}

export default App
