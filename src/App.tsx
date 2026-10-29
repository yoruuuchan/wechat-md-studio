import { Route, Routes } from 'react-router'
import EditorPage from '@/pages/EditorPage'
import Themes from '@/pages/Themes'
import { LazyRoute } from '@/components/LazyRoute'

// 编辑器和模板库是两个主入口，静态留在入口包里：编辑器本来就是入口主体，
// 模板库自身代码很小且不再包含全量主题实现（那部分已经按来源懒加载），
// 这样从编辑器切到模板库不必再等一次 dynamic import。其余页面按路由拆包，
// 致谢页因此不再把 credits 文案塞进每个访客的首屏。
const loadLogin = () => import('@/pages/Login')
const loadMaterials = () => import('@/pages/Materials')
const loadDrafts = () => import('@/pages/Drafts')
const loadReferences = () => import('@/pages/References')
const loadTerms = () => import('@/pages/Terms')
const loadFeedback = () => import('@/pages/Feedback')
const loadNotFound = () => import('@/pages/NotFound')

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<EditorPage />} />
      <Route path="/login" element={<LazyRoute loader={loadLogin} />} />
      <Route path="/materials" element={<LazyRoute loader={loadMaterials} />} />
      <Route path="/drafts" element={<LazyRoute loader={loadDrafts} />} />
      <Route path="/themes" element={<Themes />} />
      <Route path="/references" element={<LazyRoute loader={loadReferences} />} />
      <Route path="/terms" element={<LazyRoute loader={loadTerms} />} />
      <Route path="/feedback" element={<LazyRoute loader={loadFeedback} />} />
      <Route path="*" element={<LazyRoute loader={loadNotFound} />} />
    </Routes>
  )
}
