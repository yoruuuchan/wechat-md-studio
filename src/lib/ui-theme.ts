// 主题：akari（灯）/ yoru（夜）。默认跟随系统，显式选择才写 localStorage。
// 属性挂在 <html> 上，两套 token（src/index.css）才能覆盖整棵子树；
// 编辑器那块"深色井"以前靠容器上的 data-theme="yoru" 局部生效，
// 等它改成跟随主题后，这里就是全站唯一的开关。

export type ThemeName = 'akari' | 'yoru'
export type ThemeChoice = ThemeName | 'system'

const KEY = 'mopai.theme.v1'
const QUERY = '(prefers-color-scheme: dark)'

export function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'akari' || raw === 'yoru' || raw === 'system') return raw
  } catch {
    // 隐私模式下读不到就当跟随系统
  }
  return 'system'
}

export function resolveTheme(choice: ThemeChoice): ThemeName {
  if (choice !== 'system') return choice
  return window.matchMedia(QUERY).matches ? 'yoru' : 'akari'
}

export function applyTheme(name: ThemeName): void {
  const root = document.documentElement
  root.dataset.theme = name
  // Tailwind 的 dark: 变体挂在 .dark 类上（tailwind.config 的 darkMode: ["class"]）。
  // shadcn 组件（Tabs / Dialog / Popover / Select…）全靠这批语义 token，
  // 少了这个类，深色下它们仍拿浅色值——侧栏标签就成了黑字配深底。
  root.classList.toggle('dark', name === 'yoru')
  // 让原生控件、滚动条、表单跟随，否则暗色下会冒出亮色的系统部件
  root.style.colorScheme = name === 'yoru' ? 'dark' : 'light'
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // 存不下也照样生效，只是下次打开回到跟随系统
  }
  applyTheme(resolveTheme(choice))
}

/**
 * 应用当前选择，并在"跟随系统"时订阅系统偏好的变化。
 * 返回取消订阅；在 createRoot 之前调用，避免首帧闪一下另一种主题。
 */
export function initTheme(): () => void {
  const mq = window.matchMedia(QUERY)
  const sync = () => applyTheme(resolveTheme(readChoice()))
  sync()
  mq.addEventListener('change', sync)
  return () => mq.removeEventListener('change', sync)
}
