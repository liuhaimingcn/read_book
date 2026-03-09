import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Room from './pages/Room'
import Highlights from './pages/Highlights'
import HighlightsAll from './pages/HighlightsAll'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="/room/:roomId/highlights" element={<Highlights />} />
      <Route path="/highlights" element={<HighlightsAll />} />
    </Routes>
  )
}

export default App
