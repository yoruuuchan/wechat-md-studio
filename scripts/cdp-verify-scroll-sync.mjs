// Headless-Chrome check for two-way scroll sync.
//
// The panes must agree on *content*, not on percentage of height: the block at
// the top of the editor viewport has to be the block at the top of the preview,
// at full window size, in a narrower window, after a resize with no reload, and
// after the preview reflows for its own reasons (a late image, a new paper
// width, a re-render). Run against a local dev server, never against production.
//
//   node scripts/cdp-verify-scroll-sync.mjs [appUrl] [accessKey] [cdpPort]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appUrl = process.argv[2] || 'http://localhost:3000/'
const PORT = Number(process.argv[4] || 9336)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
/**
 * The unit sync works in is a block, so the acceptance is the same: whatever is
 * at the top of the editor viewport has to be the block at the top of the
 * preview. `SLACK` covers the seam - the blank paragraph a boxed module is
 * anchored above, the padding between blocks. A block's own interior is
 * interpolated, not exact: a table row is one source line but a hundred pixels
 * tall, so a line inside a tall block may sit anywhere within that block.
 */
const SLACK = 64

function accessKeyFromEnv() {
  if (process.argv[3]) return process.argv[3]
  if (process.env.ACCESS_KEY) return process.env.ACCESS_KEY
  try {
    const env = fs.readFileSync(path.join(import.meta.dirname, '..', '.env'), 'utf8')
    return (env.match(/^ACCESS_KEY=(.*)$/m) || [])[1]?.trim() || ''
  } catch {
    return ''
  }
}
const accessKey = accessKeyFromEnv()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-sync-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('no CDP endpoint')
}

let id = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = id++
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i)
          reject(new Error('timeout ' + method))
        }
      }, 30000)
    })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)

async function evaluate(expression) {
  const r = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''),
    )
  }
  return r.result.value
}

async function goto(url) {
  await send('Page.navigate', { url }, sessionId)
  await sleep(3500)
}

async function resize(width, height) {
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false },
    sessionId,
  )
  await sleep(700)
}

// ---------------------------------------------------------------------------
await goto(appUrl)
if (accessKey) {
  await evaluate(
    `fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({json:{accessKey:${JSON.stringify(accessKey)}}})}).then(r=>r.text())`,
  )
  await goto(appUrl)
}
await sleep(2000)

// ---- page-side probe: anchored to the two real scrollers --------------------
await evaluate(`(() => {
  const plain = (line) => line
    .replace(/^\\s*#{1,6}\\s*/, '')
    .replace(/^\\s*[-*]\\s+/, '')
    .replace(/^\\s*\\d+\\.\\s+/, '')
    .replace(/^\\s*:::.*$/, '')
    .replace(/!\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
    .replace(/\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
    .replace(/[*\`~=]/g, '')
    .trim()
  const norm = (s) => s.replace(/[^\\p{L}\\p{N}]+/gu, '')
  const v = window.__mopaiCodemirror
  const lines = v.state.doc.toString().split('\\n')
  const counts = new Map()
  for (const l of lines) {
    const n = norm(plain(l))
    if (n.length >= 6) counts.set(n, (counts.get(n) || 0) + 1)
  }
  const anchors = []
  for (let i = 0; i < lines.length; i++) {
    const n = norm(plain(lines[i]))
    if (n.length >= 6 && counts.get(n) === 1) anchors.push({ line: i, text: plain(lines[i]), norm: n })
  }
  // Keep a spread of anchors: enough to see drift, few enough to stay quick.
  const step = Math.max(1, Math.floor(anchors.length / 12))
  window.__probe = {
    plain, norm,
    anchors: anchors.filter((_, i) => i % step === 0),
    panes() {
      const content = document.querySelector('div.px-1.py-6')
      return { content, pv: content && content.closest('[class*="overflow-y-auto"]') }
    },
  }
  return anchors.length
})()`)

const anchorCount = await evaluate(`window.__probe.anchors.length`)
console.log(`=== probe ready: ${anchorCount} unique-text lines, ${await evaluate(`window.__probe.anchors.length`)} anchors ===`)

// Wait for the preview to stop changing height on its own (images arriving from
// the network): measurements taken mid-load are noise, not a sync bug.
console.log('\n=== waiting for the preview to settle ===')
let lastH = -1
let stable = 0
for (let i = 0; i < 30; i++) {
  const h = await evaluate(`(() => {
    const { pv } = window.__probe.panes()
    return pv ? pv.scrollHeight : -1
  })()`)
  stable = h === lastH ? stable + 1 : 0
  lastH = h
  if (stable >= 3) break
  await sleep(500)
}
console.log(`  preview content height settled at ${lastH}`)

/**
 * For every anchor: where it sits relative to each pane's viewport top.
 * `yEd` is editor pixels, `yPv` preview pixels. When the panes agree, the anchor
 * nearest the top of one pane is near the top of the other.
 */
async function anchorPositions() {
  const raw = await evaluate(`(() => {
    const { content, pv } = window.__probe.panes()
    const v = window.__mopaiCodemirror
    if (!content || !pv || !v) return JSON.stringify({ error: 'panes missing' })
    const root = content.firstElementChild
    const children = [...root.children]
    const base = pv.getBoundingClientRect().top - pv.scrollTop
    const tops = children.map((el) => el.getBoundingClientRect().top - base)
    const texts = children.map((el) => window.__probe.norm(el.textContent || ''))
    const edTop = v.scrollDOM.scrollTop
    const edMax = v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight
    const out = []
    for (const a of window.__probe.anchors) {
      let idx = -1
      for (let i = 0; i < texts.length; i++) if (texts[i].includes(a.norm)) { idx = i; break }
      if (idx < 0) continue
      const lineTop = v.lineBlockAt(v.state.doc.line(a.line + 1).from).top
      out.push({
        line: a.line,
        text: a.text.slice(0, 16),
        yEd: Math.round(lineTop - edTop),
        yPv: Math.round(tops[idx] - pv.scrollTop),
        pvTop: Math.round(tops[idx]),
        hPv: Math.round(children[idx].getBoundingClientRect().height),
      })
    }
    const blk = v.lineBlockAtHeight(Math.max(0, edTop))
    return JSON.stringify({
      anchors: out,
      edTop: Math.round(edTop),
      edMax: Math.round(edMax),
      edTopLine: v.state.doc.lineAt(blk.from).number - 1,
      pvTop: Math.round(pv.scrollTop),
      pvMax: Math.round(pv.scrollHeight - pv.clientHeight),
      docLines: v.state.doc.lines,
    })
  })()`)
  return JSON.parse(raw)
}

/** Pin the editor so an anchor's source line is exactly at its viewport top. */
async function pinEditor(anchor, settle = 340) {
  const took = await evaluate(`(() => {
    const v = window.__mopaiCodemirror
    // Rounded up: a line block's top is fractional, and assigning the fraction
    // can leave the *previous* line covering the viewport top by a fraction of
    // a pixel - which would make the pin test a different line than asked for.
    const top = Math.ceil(v.lineBlockAt(v.state.doc.line(${anchor.line + 1}).from).top)
    const max = v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight
    v.scrollDOM.scrollTop = top
    v.scrollDOM.dispatchEvent(new Event('scroll'))
    return JSON.stringify({ top, max, reachable: top <= max + 1 })
  })()`)
  await sleep(settle)
  return JSON.parse(took)
}

/** The anchor closest to the top of the editor, and its offset in the preview. */
function topAnchor(state) {
  let best = null
  for (const a of state.anchors) {
    if (!best || Math.abs(a.yEd) < Math.abs(best.yEd)) best = a
  }
  return best
}

const results = {}
/** Is the anchor inside the block the panes put at the top? */
function withinBlockBox(r) {
  return r.yPv <= SLACK && r.yPv >= -(r.hPv + SLACK)
}

async function sweep(label) {
  const rows = []
  for (const anchor of await evaluate(`JSON.stringify(window.__probe.anchors)`).then(JSON.parse)) {
    const info = await pinEditor(anchor)
    if (!info.reachable) {
      rows.push({ line: anchor.line, skipped: true })
      continue
    }
    const st = await anchorPositions()
    const row = st.anchors.find((a) => a.line === anchor.line)
    rows.push({ ...row, skipped: false, edTopLine: st.edTopLine })
  }
  const kept = rows.filter((r) => !r.skipped && r.yEd !== undefined)
  const bad = kept.filter((r) => !withinBlockBox(r) || Math.abs(r.yEd) > 2)
  console.log(`\n=== ${label} ===`)
  for (const r of rows) {
    console.log(
      r.skipped
        ? `   line ${String(r.line).padStart(3)}  (unreachable: editor cannot put it at the top)`
        : `   line ${String(r.line).padStart(3)}  yEd=${String(r.yEd).padStart(5)} yPv=${String(r.yPv).padStart(6)} hPv=${String(r.hPv).padStart(4)}  ${r.text}`,
    )
  }
  check(
    `${label}: the block at the top of the editor is at the top of the preview`,
    bad.length === 0,
    `${bad.length}/${kept.length} outside the block box${bad.length ? `: ${bad.map((b) => `line ${b.line} yPv=${b.yPv} hPv=${b.hPv}`).join(', ')}` : ''}`,
  )
  const half = Math.floor(kept.length / 2)
  const avg = (a) => (a.length ? Math.round(a.reduce((s, r) => s + Math.abs(r.yPv), 0) / a.length) : 0)
  console.log(
    `   mean |yPv|: first half ${avg(kept.slice(0, half))}px, second half ${avg(kept.slice(half))}px, ` +
      `worst ${Math.max(...kept.map((r) => Math.abs(r.yPv)))}px`,
  )
  results[label] = rows
  return rows
}

/**
 * Drift is a position that depends on the way you arrived at it. Walk every
 * anchor downwards, remember where the preview landed, then walk back up and
 * compare: a mapping that accumulates error shows up here as the two walks
 * disagreeing, growing towards the end of the article.
 */
async function hysteresis(label) {
  const anchors = await evaluate(`JSON.stringify(window.__probe.anchors)`).then(JSON.parse)
  const forward = new Map()
  for (const a of anchors) {
    const info = await pinEditor(a)
    if (!info.reachable) continue
    const st = await anchorPositions()
    const row = st.anchors.find((r) => r.line === a.line)
    if (row) forward.set(a.line, row.pvTop)
  }
  let worst = 0
  let worstLine = -1
  for (const a of [...anchors].reverse()) {
    if (!forward.has(a.line)) continue
    await pinEditor(a)
    const st = await anchorPositions()
    const row = st.anchors.find((r) => r.line === a.line)
    if (!row) continue
    const delta = Math.abs(row.pvTop - forward.get(a.line))
    if (delta > worst) {
      worst = delta
      worstLine = a.line
    }
  }
  console.log(`\n=== ${label} ===`)
  check(
    `${label}: the preview lands on the same pixel from both directions`,
    worst <= 4,
    `worst ${worst}px at line ${worstLine} over ${forward.size} anchors`,
  )
}

// 1. Full window -------------------------------------------------------------
await resize(1440, 900)
await sweep('full window 1440x900')
await hysteresis('full window: no drift in either direction')

// 2. Narrower window: the editor rewraps, the preview paper does not ----------
await resize(1000, 640)
await sweep('narrow window 1000x640')

// 3. Layout changes with no scrolling at all ---------------------------------
console.log('\n=== layout changes re-align by themselves ===')
async function checkSelfHealing(label, mutate, measure) {
  // Land on a known anchor first, so the check has a definite subject.
  const anchors = await evaluate(`JSON.stringify(window.__probe.anchors)`).then(JSON.parse)
  const mid = anchors[Math.floor(anchors.length / 2)]
  await pinEditor(mid)
  const before = await anchorPositions()
  const hBefore = await evaluate(measure)
  await mutate()
  await sleep(900)
  const hAfter = await evaluate(measure)
  const after = await anchorPositions()
  const top = topAnchor(after)
  check(
    `${label}: something really did reflow`,
    hAfter !== hBefore,
    `${measure} ${hBefore} → ${hAfter}`,
  )
  check(
    `${label}: panes still agree afterwards`,
    !!top && withinBlockBox(top),
    top
      ? `top anchor line ${top.line} yPv=${top.yPv} hPv=${top.hPv} (was yPv=${before.anchors.find((a) => a.line === top.line)?.yPv})`
      : 'no anchor found',
  )
  // And a normal scroll afterwards must land exactly, not approximately.
  await pinEditor(mid)
  const rec = await anchorPositions()
  const row = rec.anchors.find((a) => a.line === mid.line)
  check(
    `${label}: scrolling after the change aligns again`,
    !!row && Math.abs(row.yEd) <= 2 && withinBlockBox(row),
    row ? `line ${mid.line} yEd=${row.yEd} yPv=${row.yPv} hPv=${row.hPv}` : 'anchor lost',
  )
  return after
}

await checkSelfHealing(
  'window resize (the editor rewraps)',
  async () => {
    await resize(1180, 700)
    await resize(1440, 900)
  },
  `window.__mopaiCodemirror.scrollDOM.scrollHeight`,
)

await checkSelfHealing(
  'preview paper width change (375→677)',
  async () => {
    await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '677')
      if (btn) btn.click()
      return !!btn
    })()`)
    await sleep(1200)
  },
  `window.__probe.panes().pv.scrollHeight`,
)

await checkSelfHealing(
  'preview content grows late (a slow image arrives)',
  async () => {
    await evaluate(`(() => {
      // Grow a block above the viewport, which is what a late image does to
      // everything below it.
      const first = document.querySelector('div.px-1.py-6 section').firstElementChild
      if (!first) return 'no block'
      first.setAttribute('style', (first.getAttribute('style') || '') + ';padding-top:420px;')
      return 'grown'
    })()`)
    await sleep(900)
  },
  `window.__probe.panes().pv.scrollHeight`,
)

// 4. Two-way: the preview drives the editor ----------------------------------
console.log('\n=== preview drives the editor ===')
const drive = await evaluate(`(() => {
  const { content, pv } = window.__probe.panes()
  const children = [...content.firstElementChild.children]
  const base = pv.getBoundingClientRect().top - pv.scrollTop
  const tops = children.map((el) => el.getBoundingClientRect().top - base)
  const anchors = window.__probe.anchors
  const want = anchors[Math.floor(anchors.length / 2)]
  let idx = -1
  for (let i = 0; i < children.length; i++) {
    if (window.__probe.norm(children[i].textContent).includes(want.norm)) { idx = i; break }
  }
  if (idx < 0) return JSON.stringify({ error: 'anchor not in preview' })
  pv.scrollTop = tops[idx]
  pv.dispatchEvent(new Event('scroll'))
  return JSON.stringify({ want: want.line, pvTop: tops[idx] })
})()`)
await sleep(600)
const driven = JSON.parse(drive)
const stAfter = await anchorPositions()
check(
  'preview → editor lands on the same block',
  !driven.error && Math.abs(stAfter.edTopLine - driven.want) <= 4,
  `preview pinned line ${driven.want}, editor top line ${stAfter.edTopLine}`,
)

// 5. Settling: no creeping after the sync stops -------------------------------
console.log('\n=== settling ===')
await pinEditor(await evaluate(`window.__probe.anchors[2]`).then((a) => a))
const sA = await anchorPositions()
await sleep(1000)
const sB = await anchorPositions()
check(
  'both panes settle instead of creeping',
  Math.abs(sA.edTop - sB.edTop) <= 2 && Math.abs(sA.pvTop - sB.pvTop) <= 2,
  `editor ${sA.edTop}→${sB.edTop}, preview ${sA.pvTop}→${sB.pvTop}`,
)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
chrome.kill()
process.exit(failures === 0 ? 0 : 1)
