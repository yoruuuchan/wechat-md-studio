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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
