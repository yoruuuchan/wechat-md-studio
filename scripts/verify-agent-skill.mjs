// Acceptance for the shipped agent client: drives `skills/wechat-typesetter`
// (the real Python script, unmodified, from a temp copy) against a real server.
//
// cdp-verify-agent.mjs proves the HTTP door and the browser half. This proves the
// thing an agent will actually run: that the CLI's flags, exit codes, JSON output,
// .env handling and local-image rewriting all agree with the server it talks to.
//
// It brings its own in-memory image worker, so no test object reaches production
// R2. Skips itself (exit 0, loudly) where Python 3 is not installed.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const APP_PORT = Number(process.argv[2] || 3219)
const WORKER_PORT = APP_PORT + 10
const baseUrl = `http://127.0.0.1:${APP_PORT}`
const ACCESS_KEY = 'skill-acceptance-key'
const ADMIN_KEY = 'skill-acceptance-admin'
const WRITE_TOKEN = 'mopai_skill_acceptance_write'
const READ_TOKEN = 'mopai_skill_acceptance_read'
const DB_FILE = path.resolve('data/test-agent-skill.db')
const SKILL_DIR = path.resolve('skills/wechat-typesetter')
const PY = process.platform === 'win32' ? 'python' : 'python3'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const probe = spawnSync(PY, ['--version'], { encoding: 'utf8' })
if (probe.status !== 0) {
  console.log(`SKIP: no \`${PY}\` on PATH, so the skill client cannot be exercised here.`)
  console.log('      Everything else is still covered by cdp-verify-agent.mjs.')
  process.exit(0)
}
console.log(`python: ${(probe.stdout || probe.stderr || '').trim()}`)

// ---------- mock image worker ----------
const objects = new Map()
const worker = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/api/upload') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) {
      res.writeHead(403).end('bad admin key')
      return
    }
    const key = url.searchParams.get('key') ?? ''
    if (req.method === 'DELETE') {
      objects.delete(key)
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      objects.set(key, { body, type: req.headers['content-type'] || 'application/octet-stream' })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ key, size: body.length }))
    })
    return
  }
  if (url.pathname.startsWith('/img/')) {
    const obj = objects.get(decodeURIComponent(url.pathname.slice('/img/'.length)))
    if (!obj) {
      res.writeHead(404).end('missing')
      return
    }
    res.writeHead(200, { 'content-type': obj.type })
    res.end(obj.body)
    return
  }
  res.writeHead(404).end('no route')
})
await new Promise((r) => worker.listen(WORKER_PORT, '127.0.0.1', r))

// ---------- app server ----------
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })
try { fs.rmSync(DB_FILE, { force: true }) } catch { /* nothing to clear */ }
const app = spawn(process.execPath, ['dist/boot.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(APP_PORT),
    DATABASE_URL: 'file:./data/test-agent-skill.db',
    IMG_BASE_URL: `http://127.0.0.1:${WORKER_PORT}`,
    IMG_ADMIN_KEY: ADMIN_KEY,
    ACCESS_KEY,
    SESSION_SECRET: 'skill-acceptance-session-secret-5a8d',
    AGENT_TOKENS: `skill-test:${WRITE_TOKEN},reviewer:${READ_TOKEN}:read`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let appLog = ''
app.stdout.on('data', (d) => (appLog += d))
app.stderr.on('data', (d) => (appLog += d))

async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${baseUrl}/`, { redirect: 'manual' })
      if (r.status < 500) return
    } catch { /* not listening yet */ }
    await sleep(250)
  }
  throw new Error(`app never came up on ${APP_PORT}\n${appLog.slice(-800)}`)
}

// ---------- a relocatable copy of the skill ----------
// Copied rather than used in place: the script must work from any directory (that
// is how it gets installed into a harness's skill folder), and this way the run
// cannot leave a real `.env` behind inside the repository.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-skill-'))
const skill = path.join(work, 'wechat-typesetter')
fs.cpSync(SKILL_DIR, skill, { recursive: true })
const script = path.join(skill, 'scripts', 'mopai.py')
const envFile = path.join(skill, '.env')

/** 1x1 PNG, so anything that decodes it downstream has real pixels to work with. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+p7RLAAAAAElFTkSuQmCC',
  'base64',
)

function writeEnv(token, apiUrl = baseUrl) {
  fs.writeFileSync(envFile, `MOPAI_API_URL=${apiUrl}\nMOPAI_TOKEN=${token}\n`, 'utf8')
}

/**
 * Run the client. cwd is the temp root, never the skill dir, on purpose.
 *
 * Async on purpose: the mock image worker lives in *this* process, and
 * `spawnSync` would freeze the event loop for the whole call — the client would
 * wait for an upload that cannot be served until it gives up. That cost an hour
 * of chasing a "server hang" that was entirely the harness's doing.
 */
function run(args, { stdin, cwd = work } = {}) {
  return new Promise((resolve) => {
    const child = spawn(PY, [script, ...args], {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => resolve({ status: -1, stdout, stderr: stderr + String(e.message), json: null }))
    child.on('close', (status) => {
      // Data goes to stdout, error objects to stderr — parse whichever has JSON.
      let json = null
      for (const text of [stdout, stderr]) {
        try { json = JSON.parse(text); break } catch { /* try the other stream */ }
      }
      resolve({ status, stdout, stderr, json })
    })
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

try {
  await waitUp()

  console.log('\n=== a cold skill directory reports what to do, not a traceback ===')
  fs.writeFileSync(envFile, `MOPAI_API_URL=${baseUrl}\n`, 'utf8')
  const cold = await run(['whoami'])
  check('it fails with exit 1', cold.status === 1, `exit ${cold.status}`)
  check('it says the token is missing', cold.json?.error?.includes('缺少令牌') === true, cold.stdout.slice(0, 120) + cold.stderr.slice(0, 200))
  // Node's os.tmpdir() gives the 8.3 short form (E:\SYSTEM~2\…) and Python's
  // Path.resolve() expands it, so the same file never compares equal as a
  // string. What matters is that it points at a real file in the skill dir.
  const reportedEnv = String(cold.json?.envFile ?? '')
  check(
    'it names the .env it looked in',
    reportedEnv.toLowerCase().endsWith(path.join('wechat-typesetter', '.env').toLowerCase()) && fs.existsSync(reportedEnv),
    reportedEnv,
  )
  check('no Python traceback leaks out', !cold.stderr.includes('Traceback'), cold.stderr.slice(0, 200))
  const status0 = await run(['token-status'])
  check('token-status works without a token and reports not ready', status0.status === 0 && status0.json?.ready === false, status0.stdout.slice(0, 120))

  console.log('\n=== set-token writes the .env in place ===')
  const set = await run(['set-token'], { stdin: `${WRITE_TOKEN}\n` })
  check('set-token accepts the token on stdin', set.status === 0 && set.json?.ok === true, set.stdout.slice(0, 160))
  check('it masks the token in its own output', !set.stdout.includes(WRITE_TOKEN) && String(set.json?.token).includes('…'), set.json?.token)
  check('the .env now carries it', fs.readFileSync(envFile, 'utf8').includes(`MOPAI_TOKEN=${WRITE_TOKEN}`))
  check('it did not stack a second MOPAI_API_URL line', (fs.readFileSync(envFile, 'utf8').match(/MOPAI_API_URL=/g) || []).length === 1)

  console.log('\n=== whoami / themes ===')
  const who = await run(['whoami'])
  check('whoami reports the token name', who.status === 0 && who.json?.agent === 'skill-test', who.stdout.slice(0, 160))
  const themes = await run(['themes'])
  check('themes come back as a list from the server', themes.status === 0 && Array.isArray(themes.json) && themes.json.length >= 9, `${themes.json?.length} themes`)
  check('no theme list is hardcoded in the script', !fs.readFileSync(script, 'utf8').includes("'golden'") && !fs.readFileSync(script, 'utf8').includes('"golden"'))

  console.log('\n=== push uploads the local image and rewrites the reference ===')
  // The article lives in a subdirectory on purpose: relative image paths must
  // resolve against the Markdown file, not the process cwd.
  const articleDir = path.join(work, 'articles')
  fs.mkdirSync(articleDir, { recursive: true })
  fs.writeFileSync(path.join(articleDir, 'cover.png'), PNG)
  const article = [
    '---',
    'titles:',
    '  - 技能推来的稿子',
    '---',
    '',
    '## 缘起 | 开头',
    '',
    '正文一段。',
    '',
    '![封面](cover.png)',
    '',
    '![缺图](./not-here.png)',
    '',
  ].join('\n')
  const articlePath = path.join(articleDir, 'draft.md')
  fs.writeFileSync(articlePath, article, 'utf8')

  const pushed = await run(['push', '--file', articlePath])
  check('push succeeds', pushed.status === 0 && pushed.json?.ok === true, pushed.stdout.slice(0, 200) + pushed.stderr.slice(0, 300))
  check('it uploaded the one image that exists', pushed.json?.uploadedImages === 1, String(pushed.json?.uploadedImages))
  check('the missing image became a warning, not a failure', Array.isArray(pushed.json?.warnings) && pushed.json.warnings.length === 1, JSON.stringify(pushed.json?.warnings))
  check('the object really reached storage', objects.size === 1, `${objects.size} object(s)`)
  const docId = pushed.json?.id
  check('it hands back an absolute editor link', pushed.json?.editorUrl === `${baseUrl}/?doc=${docId}`, pushed.json?.editorUrl)
  check('it hands back the lock hash', typeof pushed.json?.hash === 'string' && pushed.json.hash.length === 16, String(pushed.json?.hash))
  check('the title came from the front matter', pushed.json?.name === '技能推来的稿子', pushed.json?.name)

  const fetched = await run(['get', docId])
  const body = fetched.stdout
  check('get prints the Markdown', fetched.status === 0 && body.includes('正文一段'), body.slice(0, 80))
  check('the local path was rewritten to an img: reference', /!\[封面\]\(img:[^)]+\)/.test(body), (body.match(/!\[封面\]\([^)]*\)/) || [])[0])
  check('…and not to the worker URL', !body.includes(`127.0.0.1:${WORKER_PORT}`))
  check('a failed image keeps its original reference', body.includes('![缺图](./not-here.png)'))

  console.log('\n=== get --out keeps the hash for the way back ===')
  const outPath = path.join(work, 'roundtrip.md')
  const got = await run(['get', docId, '--out', outPath])
  check('the file was written', got.status === 0 && fs.existsSync(outPath), got.stdout.slice(0, 160))
  check('stdout carries the hash instead of the body', got.json?.hash === pushed.json?.hash, String(got.json?.hash))
  const serverCopy = await (await fetch(`${baseUrl}/api/agent/docs/${docId}`, {
    headers: { authorization: `Bearer ${WRITE_TOKEN}` },
  })).json()
  check('the file is byte-identical to what the server has', fs.readFileSync(outPath, 'utf8') === serverCopy.content, `${fs.statSync(outPath).size} bytes vs ${serverCopy.content.length} chars`)
  check('plain get adds the trailing newline --out deliberately does not', body === serverCopy.content || body === `${serverCopy.content}\n`)

  console.log('\n=== list and search agree, and never ship content ===')
  const list = await run(['list', '--q', '技能推来的'])
  const hit = (list.json?.items || []).find((i) => i.id === docId)
  check('list finds it', list.status === 0 && Boolean(hit), list.stdout.slice(0, 160))
  check('the summary has no content field', hit && hit.content === undefined, JSON.stringify(hit))
  check('it says who pushed it', hit?.source === 'agent:skill-test', String(hit?.source))
  const search = await run(['search', '技能推来的'])
  check('search is list --q', search.status === 0 && (search.json?.items || []).some((i) => i.id === docId))
  const saved = await run(['list', '--saved'])
  check('--saved includes it, because an agent article is saved from birth', (saved.json?.items || []).some((i) => i.id === docId))

  console.log('\n=== the lock protects the human’s edits ===')
  // The owner polishes it in the browser; here the same write goes in over REST.
  const edited = `${body.replace(/\n$/, '')}\n\n## 人工精修 | 人加的一段\n`
  const byOwner = await fetch(`${baseUrl}/api/agent/docs/${docId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${WRITE_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ content: edited, baseHash: serverCopy.hash }),
  })
  check('the owner’s edit went in', byOwner.status === 200, `status ${byOwner.status}`)

  fs.writeFileSync(outPath, `${edited}\n\nAgent 又想改一笔。\n`, 'utf8')
  const clash = await run(['update', docId, '--file', outPath, '--base-hash', pushed.json.hash])
  check('a stale hash is refused', clash.status === 1 && clash.json?.ok === false && clash.json?.error === 'conflict', clash.stdout.slice(0, 200))
  check('the 409 carries the human’s current text', String(clash.json?.current?.content ?? '').includes('人工精修'))
  check('the hint names the hash to retry with', String(clash.json?.hint ?? '').includes(String(clash.json?.current?.hash ?? '—')), String(clash.json?.hint).slice(0, 120))

  const retry = await run(['update', docId, '--file', outPath, '--base-hash', clash.json.current.hash])
  check('retrying with the fresh hash works', retry.status === 0 && retry.json?.ok === true, retry.stdout.slice(0, 200))
  const afterRetry = await run(['get', docId])
  check('the retry kept the human’s paragraph', afterRetry.stdout.includes('人工精修'), afterRetry.stdout.slice(-90))

  const forced = await run(['update', docId, '--file', outPath, '--force'])
  check('--force overwrites without a lock', forced.status === 0 && forced.json?.forced === true, forced.stdout.slice(0, 160))

  console.log('\n=== read-only tokens, dead ids and the missing delete ===')
  writeEnv(READ_TOKEN)
  const readList = await run(['list'])
  check('a read-only token can list', readList.status === 0 && readList.json?.total >= 1, readList.stdout.slice(0, 120))
  const readPush = await run(['push', '--text', '# nope'])
  check('…but cannot push', readPush.status === 1 && String(readPush.json?.error ?? '').includes('权限'), (readPush.stderr || readPush.stdout).slice(0, 200))
  const dead = await run(['get', 'not-a-real-id'])
  check('a dead id reports 404', dead.status === 1 && String(dead.json?.error ?? '').includes('不存在'), (dead.stderr || dead.stdout).slice(0, 200))
  writeEnv(WRITE_TOKEN)
  const del = await run(['delete', docId])
  check('there is no delete, and it says why', del.status === 2 && String(del.json?.error ?? '').includes('不能删'), `exit ${del.status} ${(del.stderr || del.stdout).slice(0, 160)}`)

  console.log('\n=== a wrong token is reported, not retried forever ===')
  writeEnv('mopai_definitely_not_valid')
  const bad = await run(['whoami'])
  check('exit 1 with the server’s own wording', bad.status === 1 && String(bad.json?.error ?? '').includes('无效'), bad.stdout.slice(0, 160))

  console.log('\n=== --base-url overrides .env without editing it ===')
  writeEnv('mopai_definitely_not_valid', 'http://127.0.0.1:1')
  const override = await run(['whoami', '--base-url', baseUrl])
  check('the flag wins over a bogus .env URL', override.status === 1 && String(override.json?.error ?? '').includes('无效'), override.stdout.slice(0, 160))
} catch (e) {
  failures++
  console.error('\nACCEPTANCE ERROR:', e.message)
  if (appLog) console.error('--- app log tail ---\n' + appLog.slice(-1200))
} finally {
  try { app.kill() } catch { /* already gone */ }
  worker.close()
  try { fs.rmSync(DB_FILE, { force: true }) } catch { /* leave it */ }
  try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* leave it */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
