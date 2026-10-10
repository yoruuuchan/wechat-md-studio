import { Routes, Route } from 'react-router'
import EditorPage from '@/pages/EditorPage'
import Login from '@/pages/Login'
import Materials from '@/pages/Materials'
import Drafts from '@/pages/Drafts'
import Themes from '@/pages/Themes'
import References from '@/pages/References'
import Terms from '@/pages/Terms'
import Feedback from '@/pages/Feedback'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EditorPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/materials" element={<Materials />} />
      <Route path="/drafts" element={<Drafts />} />
      <Route path="/themes" element={<Themes />} />
      <Route path="/references" element={<References />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/feedback" element={<Feedback />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
