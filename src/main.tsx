import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'
import { initTheme } from './lib/ui-theme'
import { applyZoom, loadSettings } from './lib/store'
import { applyLanguage } from './lib/i18n'

// 在首帧之前定好 data-theme，跟随系统偏好的人不会先闪一下亮色
initTheme()
// 同理：整界面缩放也在首帧前生效，避免先闪一档 100%
applyZoom(loadSettings().zoom)
// 以及语言：<html lang> 与标题在首帧前就是用户上次选的
applyLanguage()

// Vite 默认会在 preload 失败时整页刷新：编辑中的未落盘内容可能因此丢掉。
// 页面与主题分块各自有可重试的错误出口，这里只阻止默认刷新并留下线索。
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  console.warn('[chunk] dynamic import failed', (event as Event & { payload?: unknown }).payload)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
