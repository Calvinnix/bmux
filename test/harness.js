const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

let nextPort = 9300 + (process.pid % 200)

async function launch({ userData } = {}) {
  const port = nextPort++
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-test-'))
  const electronBinary = require(path.join(__dirname, '..', 'node_modules', 'electron'))
  const proc = spawn(electronBinary, ['.'], {
    cwd: path.join(__dirname, '..'),
    env: { BMUX_ADBLOCK: 'local', ...process.env, BMUX_DEBUG: '1', BMUX_DEBUG_PORT: String(port), BMUX_USER_DATA: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let stderr = ''
  proc.stderr.on('data', (d) => { stderr += d })

  const base = `http://127.0.0.1:${port}`
  const post = async (pathname, body) => {
    const res = await fetch(base + pathname, { method: 'POST', body: JSON.stringify(body || {}) })
    const text = await res.text()
    if (!res.ok) throw new Error(`${pathname} failed: ${text}`)
    return text && text[0] === '{' ? JSON.parse(text) : text
  }

  const app = {
    dir,
    proc,
    base,
    shot: (target = 'active') =>
      fetch(`${base}/shot?target=${target}`).then(async (r) => Buffer.from(await r.arrayBuffer())),
    state: () => fetch(base + '/state').then((r) => r.json()),
    key: (keyCode, modifiers = [], target = 'active') => post('/key', { keyCode, modifiers, target }),
    evalMain: (code) => post('/main', { code }).then((r) => r.result),
    evalIn: (target, code) => post('/eval', { target, code }).then((r) => r.result),
    prefix: async (keyCode, modifiers = []) => {
      await post('/key', { keyCode: 'b', modifiers: ['control'] })
      await post('/key', { keyCode, modifiers })
    },
    settle: (ms = 250) => new Promise((r) => setTimeout(r, ms)),
    stderr: () => stderr,
    close: async () => {
      const quit = post('/main', { code: 'setTimeout(() => app.quit(), 20); 0' }).catch(() => {})
      await Promise.race([quit, new Promise((r) => setTimeout(r, 1500))])
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try { process.kill(-proc.pid, 'SIGKILL') } catch {}
          resolve()
        }, 3000)
        if (proc.exitCode !== null) { clearTimeout(t); return resolve() }
        proc.once('exit', () => { clearTimeout(t); resolve() })
      })
    },
  }

  const deadline = Date.now() + 15000
  for (;;) {
    try {
      await app.state()
      break
    } catch {
      if (Date.now() > deadline) {
        proc.kill('SIGKILL')
        throw new Error(`bmux did not come up on :${port}\n${stderr}`)
      }
      await app.settle(200)
    }
  }
  await waitFor(app, async () => {
    const s = await app.state()
    return s.tabs.length > 0 && s.tabs[0].panes.every((p) => p.url)
  }, 'first tab loaded')
  return app
}

async function waitFor(app, cond, label, timeout = 8000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await cond()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await app.settle(150)
  }
}

function startServer(routes) {
  const http = require('http')
  const server = http.createServer((req, res) => {
    const body = routes[req.url.split('?')[0]]
    if (body === undefined) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

module.exports = { launch, waitFor, startServer }
