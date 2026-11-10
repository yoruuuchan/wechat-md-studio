// Real Chrome acceptance for the 「AI 画图表」 entry: the editor opens the dialog,
// both copy actions land in the clipboard, the Skill stays external (only its
// address is handed over), and the wording survives both languages and themes.
// node scripts/cdp-verify-ai-diagram.mjs [appPort=3228] [cdpPort=9356] [outputDir]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 3228)
const CDP_PORT = Number(process.argv[3] || 9356)
const shots = path.resolve(process.argv[4] || 'verify-out/ai-diagram')
const SKILL_URL = 'https://github.com/patrick-xin/diagram-design-zh/blob/main/skills/diagram-design-zh/SKILL.md'
const REPO_URL = 'https://github.com/patrick-xin/diagram-design-zh'
const UPSTREAM_URL = 'https://github.com/cathrynlavery/diagram-design'
const PROMPT = '[data-ai-copy="diagram-prompt"]'
const WRITING_PROMPT = '[data-ai-copy="prompt"]'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-ai-diagram-'))
const dbFile = path.join(dir, 'test.db')
const profile = path.join(dir, 'chrome')
fs.mkdirSync(shots, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
const results = []
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  results.push({ name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// The app only needs a reachable image host for its startup checks; this entry
// uploads nothing, so a stub is enough and no real 图床 is touched.
const worker = http.createServer((req, res) => res.writeHead(404).end())
await new Promise((resolve) => worker.listen(0, '127.0.0.1', resolve))
const appUrl = `http://127.0.0.1:${APP_PORT}/`
const app = spawn(process.execPath, ['dist/boot.js'], {
  env: {
    ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), DATABASE_URL: `file:${dbFile}`,
    PUBLIC_BASE_URL: appUrl, ACCESS_KEY: 'diagram-test-access-key-4e17', SESSION_SECRET: 'diagram-test-session-secret-32c-4e17',
    IMG_BASE_URL: `http://127.0.0.1:${worker.address().port}`, IMG_ADMIN_KEY: 'diagram-test-image-key-4e17', AGENT_TOKENS: '',
    ANON_GC_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => { appLog += d })
app.stderr.on('data', (d) => { appLog += d })
let chrome, ws

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(appUrl)).ok) break } catch { /* starting */ }
    if (i === 79) throw new Error(`app did not start: ${appLog.slice(-800)}`)
    await sleep(250)
  }
  chrome = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-proxy-server', '--disable-gpu', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' })
  let wsUrl
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; if (wsUrl) break } catch { /* starting */ }
    await sleep(250)
  }
  if (!wsUrl) throw new Error('Chrome CDP did not start')
  ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
  let nextId = 1
  const pending = new Map()
  const runtimeErrors = []
  const requests = []
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params?.exceptionDetails)
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params?.request?.url || '')
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30_000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.setItem("mopai.onboarding.v1","done")}catch{}' }, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Browser.grantPermissions', { origin: appUrl.slice(0, -1), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  const ev = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label, ms = 15000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      try { if (await ev(`(async () => Boolean(await (${expression})))()`)) return } catch { /* between documents */ }
      await sleep(250)
    }
    const detail = await ev(`JSON.stringify({body:document.body.innerText.slice(0,1200),buttons:[...document.querySelectorAll('[role="dialog"] button')].map(e=>({text:e.textContent,disabled:e.disabled})),errors:${JSON.stringify(runtimeErrors).slice(0, 2000)}})`)
    throw new Error(`Browser timeout: ${label}\n${detail}\n${appLog.slice(-500)}`)
  }
  const click = async (expression) => {
    await sleep(250)
    const point = await ev(`(() => { const e = ${expression}; if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); const p={x:r.left+r.width/2,y:r.top+r.height/2}; const hit=document.elementFromPoint(p.x,p.y); return e===hit || e.contains(hit) ? p : null })()`)
    if (!point) throw new Error(`Missing button: ${expression}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, sessionId)
  }
  const select = (selector) => `document.querySelector(${JSON.stringify(selector)})`
  // At phone widths the editor mounts its own off-screen drawers with role=dialog;
  // every query below is scoped to the dialog that owns the marker being tested.
  const dialogWith = (marker) => `[...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector(${JSON.stringify(marker)}))`
  // The entrance animation carries its own transform, so measuring or clicking
  // before it settles reads the mid-animation geometry. Wait for it explicitly.
  const opened = async (marker) => {
    await waitFor(dialogWith(marker), `${marker} dialog`)
    await ev(`(async () => {
      const d = ${dialogWith(marker)}
      if (d && typeof d.getAnimations === 'function') await Promise.allSettled(d.getAnimations({ subtree: true }).map((a) => a.finished))
      return true
    })()`)
    await sleep(120)
  }
  const closeDialog = async (marker) => {
    await click(`${dialogWith(marker)}.querySelector('button[data-slot="dialog-close"]')`)
    await waitFor(`!${dialogWith(marker)}`, `${marker} dialog closed`)
    await sleep(200)
  }
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    fs.writeFileSync(path.join(shots, file), Buffer.from(data, 'base64'))
  }
  const setTheme = (theme) => ev(`(() => {
    localStorage.setItem('mopai.theme.v1', ${JSON.stringify(theme)})
    document.documentElement.dataset.theme = ${JSON.stringify(theme)}
    document.documentElement.classList.toggle('dark', ${JSON.stringify(theme)} === 'yoru')
    document.documentElement.style.colorScheme = ${JSON.stringify(theme)} === 'yoru' ? 'dark' : 'light'
    return true
  })()`)
  const lang = (value) => ev(`localStorage.setItem('mopai.lang.v1', ${JSON.stringify(value)})`)
  const load = async () => {
    await send('Page.navigate', { url: appUrl }, sessionId)
    await waitFor(`window.__mopaiCodemirror?.state.doc.length > 100`, 'hydrated editor', 30000)
  }
  const dialogText = (marker) => ev(`(${dialogWith(marker)})?.innerText || ''`)
  const dialogPrompt = (marker) => ev(`${dialogWith(marker)}.querySelector('textarea').value`)
  const copyAndRead = async (selector) => {
    await click(select(selector))
    await sleep(200)
    return (await ev('navigator.clipboard.readText()')).replace(/\r\n/g, '\n')
  }
  const sinceMark = () => { const start = requests.length; return () => requests.slice(start) }

  // 1) Chinese interface, light theme: the entry sits next to 「AI 帮我写」 and the
  //    dialog offers the prompt plus the external Skill address.
  await load()
  await setTheme('akari')
  const entries = await ev(`(() => {
    const row = document.querySelector('[data-open-ai-writing]')?.parentElement
    return row ? [...row.querySelectorAll('button')].map((b) => b.textContent.trim()) : []
  })()`)
  check('both AI entries share one row', entries.join('|') === 'AI 帮我写|AI 画图表', entries.join('|'))

  const docBefore = await ev('window.__mopaiCodemirror.state.doc.toString()')
  const marked = sinceMark()
  await click(select('[data-open-ai-diagram]'))
  await opened(PROMPT)
  const text = await dialogText(PROMPT)
  // innerText carries the visible copy; the prompt itself is checked separately below.
  const zhWants = ['AI 图表', 'diagram-design-zh', 'PNG', '素材库', '架构图', '流程图', '柱状图', 'patrick-xin', 'MIT', 'Cathryn Lavery', '复制提示词', '复制 Skill 地址']
  const zhMissing = zhWants.filter((w) => !text.includes(w))
  check('Chinese dialog covers examples, prompt, PNG upload and credit', zhMissing.length === 0, zhMissing.join(','))
  // The dialog explains itself with pictures; the copy is meant to stay one sentence.
  check('visible copy stays short', text.length < 420, `${text.length} chars`)
  const zhPrompt = await dialogPrompt(PROMPT)
  check('prompt asks to read the Skill and export a PNG',
    zhPrompt.includes(SKILL_URL) && zhPrompt.includes('图表 Skill') && zhPrompt.includes('图表类型') && zhPrompt.includes('PNG') && zhPrompt.includes('doc-inline') && zhPrompt.includes('选择合适') && zhPrompt.includes('中文排版'),
    `${zhPrompt.length} chars`)

  const copiedPrompt = await copyAndRead(PROMPT)
  check('copy prompt puts the Skill address on the clipboard', copiedPrompt === zhPrompt && copiedPrompt.includes(SKILL_URL) && copiedPrompt.length > 200, `${copiedPrompt.length} chars`)
  check('copy Skill URL copies exactly the address', (await copyAndRead('[data-ai-copy="diagram-url"]')) === SKILL_URL)
  const links = await ev(`(() => {
    const dialog = ${dialogWith(PROMPT)}
    const pick = (href) => { const a = dialog.querySelector('a[href="' + href + '"]'); return a ? { target: a.target, rel: a.rel, text: a.textContent } : null }
    return { skill: pick(${JSON.stringify(SKILL_URL)}), repo: pick(${JSON.stringify(REPO_URL)}), upstream: pick(${JSON.stringify(UPSTREAM_URL)}) }
  })()`)
  check('Skill, repository and original are linked with rel=noreferrer',
    ['skill', 'repo', 'upstream'].every((k) => links[k] && links[k].target === '_blank' && links[k].rel.includes('noreferrer')),
    JSON.stringify(links))
  check('attribution names the author and the English original',
    links.repo?.text === 'patrick-xin/diagram-design-zh' && links.upstream?.text === 'cathrynlavery/diagram-design',
    `${links.repo?.text} / ${links.upstream?.text}`)
  // The three examples are what carries the explanation: real local files, decoded
  // pixels, each one a link into its own section of the upstream gallery.
  await waitFor(`[...${dialogWith(PROMPT)}.querySelectorAll('[data-diagram-example] img')].every((i) => i.complete && i.naturalWidth > 0)`, 'example images decoded')
  const examples = await ev(`(() => {
    const dialog = ${dialogWith(PROMPT)}
    const tiles = [...dialog.querySelectorAll('[data-diagram-example]')]
    return tiles.map((a) => {
      const img = a.querySelector('img')
      const r = img.getBoundingClientRect()
      return {
        src: img.getAttribute('src'),
        href: a.getAttribute('href'),
        target: a.target,
        rel: a.rel,
        loaded: img.complete && img.naturalWidth > 0,
        w: Math.round(r.width),
        h: Math.round(r.height),
        capped: img.naturalWidth > 0 && Math.round(r.width) < img.naturalWidth,
        alt: img.alt,
      }
    })
  })()`)
  check('three examples render from local files', examples.length === 3
    && examples.every((e) => e.src?.startsWith('/diagram-examples/') && e.loaded && e.w > 60 && e.capped),
    JSON.stringify(examples.map((e) => [e.src, e.loaded, e.w, e.h])))
  check('each example links to its gallery section', examples.every((e) => e.href?.startsWith('https://patrick-xin.github.io/diagram-design-zh/#') && e.target === '_blank' && e.rel.includes('noreferrer')
    && e.alt && e.alt.length > 0), JSON.stringify(examples.map((e) => e.href)))
  check('prompt box is not collapsed', await ev(`${dialogWith(PROMPT)}.querySelector('textarea').getBoundingClientRect().height >= 120`))
  // Hierarchy is the point of this entry: one well holding the only action, the
  // rest as plain reference, so it reads like 「AI 帮我写」 instead of a pile of
  // equally weighted blocks. A second well made the upload hint compete with the prompt.
  check('one primary well holds the only action', await ev(`(() => {
    const dialog = ${dialogWith(PROMPT)}
    const wells = [...dialog.querySelectorAll('.ya-well')]
    return wells.length === 1 && Boolean(wells[0].querySelector('[data-ai-copy="diagram-prompt"]'))
  })()`))
  // The type scale steps down (description > image captions >= credit), which is
  // what keeps four bands from reading as equal weight.
  const tiers = await ev(`(() => {
    const dialog = ${dialogWith(PROMPT)}
    const size = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : 0
    return {
      desc: size(dialog.querySelector('[data-slot="dialog-description"]')),
      caption: size(dialog.querySelector('[data-diagram-example] span')),
      credit: size(dialog.querySelector('[data-diagram-credit]')),
    }
  })()`)
  check('type scale steps down to the credit', tiers.desc >= 13 && tiers.caption <= 11 && tiers.credit <= 11 && tiers.desc > tiers.caption, JSON.stringify(tiers))
  // Typography: the dialog must inherit the app font stack and really have the CJK
  // face available, not fall back per glyph.
  const type = await ev(`(() => {
    const dialog = ${dialogWith(PROMPT)}
    return {
      ui: getComputedStyle(dialog).fontFamily,
      caption: getComputedStyle(dialog.querySelector('[data-diagram-example] span')).fontFamily,
      cjkReady: document.fonts.check('12px "Noto Sans SC"', '中文图表'),
      latinReady: document.fonts.check('12px "Geist"'),
    }
  })()`)
  check('dialog inherits the UI font stack and the CJK face',
    type.ui.includes('Geist') && type.ui.includes('Noto Sans SC') && type.caption.includes('Noto Sans SC') && type.cjkReady && type.latinReady,
    JSON.stringify(type))
  // Opening, reading and copying must not reach off-page: no Skill fetch, no model
  // call, no upload. The Skill stays external and the image never passes through us.
  const outbound = marked().filter((u) => !u.startsWith(appUrl) || /skill\.md|\/api\/mcp|\/api\/agent|\/api\/storage/.test(u))
  check('entry loads no Skill and calls no model or 图床', outbound.length === 0, outbound.slice(0, 3).join(' '))
  await shot('diagram-zh-akari.png')
  await closeDialog(PROMPT)
  check('dialog left the article untouched', (await ev('window.__mopaiCodemirror.state.doc.toString()')) === docBefore)

  // 2) Dark theme: the prompt area stays readable (text vs its real background).
  await setTheme('yoru')
  await click(select('[data-open-ai-diagram]'))
  await opened(PROMPT)
  check('dark theme keeps the prompt area readable', await ev(`(() => {
    const area = ${dialogWith(PROMPT)}.querySelector('textarea')
    const rgba = (s) => (s.match(/[\\d.]+/g) || []).map(Number)
    let node = area, bg = null
    while (node && !bg) {
      const c = rgba(getComputedStyle(node).backgroundColor)
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) bg = c.slice(0, 3)
      node = node.parentElement
    }
    if (!bg) return false
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const [hi, lo] = [lum(rgba(getComputedStyle(area).color)), lum(bg)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05) >= 3
  })()`))
  await shot('diagram-zh-yoru.png')
  await closeDialog(PROMPT)

  // 3) English interface: every new string really is English and keeps the URL.
  await setTheme('akari')
  await lang('en')
  await load()
  await click(select('[data-open-ai-diagram]'))
  await opened(PROMPT)
  const enText = await dialogText(PROMPT)
  const enWants = ['Diagram with AI', 'diagram-design-zh', 'PNG', 'media library', 'Architecture', 'Flowchart', 'Bar chart', 'patrick-xin', 'MIT', 'Cathryn Lavery', 'Copy prompt', 'Copy Skill URL']
  const enMissing = enWants.filter((w) => !enText.includes(w))
  check('English dialog carries the same content', enMissing.length === 0, enMissing.join(','))
  const enCjk = enText.match(/[\u3400-\u9fff]+/g) || []
  check('English dialog shows no Chinese copy', enCjk.length === 0, enCjk.join(','))
  const enPrompt = await dialogPrompt(PROMPT)
  check('English prompt still points at the same Skill',
    enPrompt.includes(SKILL_URL) && enPrompt.includes('Chinese typography') && enPrompt.includes('diagram type') && enPrompt.includes('PNG') && enPrompt.includes('doc-inline'),
    `${enPrompt.length} chars`)
  await shot('diagram-en-akari.png')
  await closeDialog(PROMPT)
  await lang('zh')

  // 4) Phone width: the two entries share the header row without pushing it sideways.
  //    Viewport width is floated rather than emulated as a phone, matching cdp-verify-i18n.mjs' 390px runs.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId)
  await load()
  const narrow = await ev(`(() => {
    const row = document.querySelector('[data-open-ai-writing]')?.parentElement?.getBoundingClientRect()
    return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, rowBottom: row ? Math.round(row.bottom) : 0 }
  })()`)
  check('390px has no horizontal overflow', narrow.scroll <= narrow.inner + 1, JSON.stringify(narrow))
  check('390px keeps both entries visible', await ev(`(() => {
    const a = document.querySelector('[data-open-ai-writing]')?.getBoundingClientRect()
    const b = document.querySelector('[data-open-ai-diagram]')?.getBoundingClientRect()
    return !!a && !!b && a.right <= window.innerWidth && b.right <= window.innerWidth && a.width > 20 && b.width > 20
  })()`))
  await click(select('[data-open-ai-diagram]'))
  await opened(PROMPT)
  const phoneDialog = await ev(`(() => {
    const c = ${dialogWith(PROMPT)}.getBoundingClientRect()
    return { left: Math.round(c.left), right: Math.round(c.right), top: Math.round(c.top), bottom: Math.round(c.bottom), w: window.innerWidth, h: window.innerHeight }
  })()`)
  check('390px dialog stays inside the viewport',
    phoneDialog.left >= -1 && phoneDialog.right <= phoneDialog.w + 1 && phoneDialog.top >= -1 && phoneDialog.bottom <= phoneDialog.h + 1,
    JSON.stringify(phoneDialog))
  await shot('diagram-zh-390.png')
  await closeDialog(PROMPT)
  await send('Emulation.clearDeviceMetricsOverride', {}, sessionId)

  // 5) The writing entry keeps working exactly as before, next to the new one.
  await click(select('[data-open-ai-writing]'))
  await opened(WRITING_PROMPT)
  check('AI 帮我写 still opens with its own prompt', await ev(`(() => {
    const v = ${dialogWith(WRITING_PROMPT)}.querySelector('textarea').value
    return v.includes('https://wechat.yoru-and-akari.dev/skill.md') && v.includes('写作 Skill')
  })()`))
  const mixed = await ev(`(() => {
    const d = ${dialogWith(WRITING_PROMPT)}
    return { onlyOne: document.querySelectorAll('[role="dialog"]').length >= 1, hasDiagram: !!d.querySelector('[data-ai-copy="diagram-prompt"]') }
  })()`)
  check('the two entries do not share a dialog', !mixed.hasDiagram, JSON.stringify(mixed))
  check('both AI dialogs keep the same single-well shape', await ev(`(() => {
    const w = ${dialogWith(WRITING_PROMPT)}
    return w.querySelectorAll('.ya-well').length === 1
  })()`))
  await closeDialog(WRITING_PROMPT)

  fs.writeFileSync(path.join(shots, 'ai-diagram.json'), JSON.stringify({ failures, results, appLog: appLog.slice(-2000) }, null, 2))
} finally {
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  chrome?.kill()
  app?.kill()
  worker?.close()
  // Chrome holds the profile lock for a moment after kill(); this scratch dir is
  // not worth failing the run over.
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* locked profile */ }
}
process.exit(failures === 0 ? 0 : 1)