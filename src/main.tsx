import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'
import { initTheme } from './lib/ui-theme'
import { applyZoom, loadSettings } from './lib/store'

// 在首帧之前定好 data-theme，跟随系统偏好的人不会先闪一下亮色
initTheme()
// 同理：整界面缩放也在首帧前生效，避免先闪一档 100%
applyZoom(loadSettings().zoom)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
