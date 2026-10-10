// A real OpenCode process performs discovery and tools/call. Only the model
// responses are deterministic, so verification needs no user's model account.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export async function verifyOpenCodeMcp({ endpoint, token, content }) {
  const binary = process.env.MOPAI_OPENCODE_BIN
  if (!binary || !fs.existsSync(binary)) return { skipped: true }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-opencode-'))
  let processHandle
  let requestError = null
  const calls = []
  let sawSkill = false
  let sawDocument = false
  let sawUpdate = false
  const model = http.createServer(async (req, res) => {
    try {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const input = JSON.parse(raw)
      const tools = input.tools?.map((t) => t.function.name) ?? []
      const results = input.messages.filter((m) => m.role === 'tool')
      const skill = results.find((m) => String(m.content).includes('完整写稿模板'))
      const document = results.map((m) => {
        try { return JSON.parse(m.content) } catch { return null }
      }).find((r) => r?.connection && r?.doc?.hash)
      const saved = results.map((m) => {
        try { return JSON.parse(m.content) } catch { return null }
      }).find((r) => r?.ok === true && r?.doc?.content === content)
      sawSkill ||= Boolean(skill)
      sawDocument ||= Boolean(document)
      sawUpdate ||= Boolean(saved)
      // OpenCode may also request a session title without any tools.
      const suffix = tools.length ? (!skill ? 'read_writing_skill' : !document ? 'read_current_document' : !saved ? 'update_current_document' : null) : null
      const name = suffix && tools.find((t) => t.endsWith(suffix))
      if (suffix && !name) throw new Error(`OpenCode did not discover ${suffix}`)
      const args = suffix === 'update_current_document' ? { content, baseHash: document.doc.hash } : {}
      const message = name
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
        : { role: 'assistant', content: 'MCP round trip complete.' }
      if (name) calls.push(suffix)
      const envelope = { id: 'test-completion', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: input.model,
        choices: [{ index: 0, message, finish_reason: name ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      if (input.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const chunk = { ...envelope, object: 'chat.completion.chunk', choices: [{ index: 0, delta: name
          ? { role: 'assistant', tool_calls: [{ index: 0, ...message.tool_calls[0] }] }
          : { role: 'assistant', content: message.content }, finish_reason: null }] }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(envelope))
    } catch (error) {
      requestError = error.message
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve))
  const modelPort = model.address().port
  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: 'mopai-test/deterministic', small_model: 'mopai-test/deterministic',
    enabled_providers: ['mopai-test'], autoupdate: false, share: 'disabled',
    provider: { 'mopai-test': { npm: '@ai-sdk/openai-compatible', name: 'Local deterministic acceptance driver',
      options: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'local-test-only' },
      models: { deterministic: { name: 'Deterministic', limit: { context: 200000, output: 8000 } } } } },
    mcp: { 'mopai-current': { type: 'remote', url: endpoint, oauth: false, headers: { Authorization: `Bearer ${token}` } } },
    permission: { '*': 'deny', 'mopai-current_*': 'allow' },
  }
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(config), { mode: 0o600 })
  const env = { ...process.env, OPENCODE_CONFIG: path.join(dir, 'opencode.json'), OPENCODE_CONFIG_DIR: dir,
    XDG_CONFIG_HOME: path.join(dir, 'config'), XDG_DATA_HOME: path.join(dir, 'data'), XDG_CACHE_HOME: path.join(dir, 'cache'),
    XDG_STATE_HOME: path.join(dir, 'state'), OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true' }
  // Do not inherit unrelated runtime overrides into an isolated client test.
  delete env.OPENCODE_CONFIG_CONTENT
  delete env.OPENCODE_SERVER_PASSWORD
  let output = ''
  let version = ''
  try {
    const versionProcess = spawn(binary, ['--version'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    versionProcess.stdout.on('data', (d) => { version += d })
    await new Promise((resolve, reject) => { versionProcess.on('error', reject); versionProcess.on('close', resolve) })
    processHandle = spawn(binary, ['run', '--pure', '--format', 'json', 'Read the writing Skill, read the current document, then update it through MCP.'], {
      cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    processHandle.stdout.on('data', (d) => { output += d })
    processHandle.stderr.on('data', (d) => { output += d })
    const timeout = setTimeout(() => processHandle.kill(), 90_000)
    const code = await new Promise((resolve, reject) => { processHandle.on('error', reject); processHandle.on('close', resolve) })
    clearTimeout(timeout)
    if (code !== 0 || requestError || !sawSkill || !sawDocument || !sawUpdate) {
      // Redact the generated bearer even if the client's diagnostics include it.
      throw new Error(`OpenCode round trip failed: code=${code}, tools=${calls.join(',')}, error=${requestError || ''}\n${output.replaceAll(token, '[redacted]').slice(-2500)}`)
    }
    return { skipped: false, version: version.trim(), calls }
  } finally {
    processHandle?.kill()
    await new Promise((resolve) => model.close(resolve))
    // This exact mkdtemp directory only contains disposable client state.
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
