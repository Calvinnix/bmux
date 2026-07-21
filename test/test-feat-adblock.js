const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { launch, waitFor, startServer } = require('./harness')

async function main() {
  const server = await startServer({
    '/page': '<title>adtest</title><div id="zap">AD</div><script src="/analytics.js"></script>',
    '/analytics.js': 'window.tracked = true',
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-test-'))
  fs.writeFileSync(path.join(dir, 'filters.txt'), '/analytics.js\n###zap\n')
  process.env.BMUX_ADBLOCK = 'local'
  const app = await launch({ userData: dir })
  try {
    await waitFor(app, () => app.evalMain('adblockReady'), 'adblock engine ready')

    await app.evalMain(`newTab('${server.url}/page'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs[1].panes[0].url.endsWith('/page')
    }, 'test page loaded')

    assert.equal(await app.evalIn('active', 'window.tracked === undefined'), true, 'filtered script never runs')
    assert.equal(
      await app.evalIn('active', `fetch('/analytics.js').then((r) => 'ok:' + r.status, () => 'blocked')`),
      'blocked',
      'network filter cancels matching requests'
    )
    assert.ok((await app.evalMain('blockedCount')) >= 1, 'blocked counter increments')

    await waitFor(app, async () =>
      (await app.evalIn('active', `getComputedStyle(document.getElementById('zap')).display`)) === 'none',
    'cosmetic filter hides the element')

    await app.evalMain(`runCommand('privacy-toggle-blocking'); 0`)
    await waitFor(app, async () => (await app.evalMain('config.blockTrackers')) === false, 'blocking toggled off')
    assert.equal(
      await app.evalIn('active', `fetch('/analytics.js').then((r) => 'ok:' + r.status, () => 'blocked')`),
      'ok:200',
      'toggle off stops blocking without restart'
    )

    await app.evalMain(`runCommand('privacy-toggle-blocking'); 0`)
    await waitFor(app, async () => (await app.evalMain('config.blockTrackers')) === true, 'blocking toggled back on')
    assert.equal(
      await app.evalIn('active', `fetch('/analytics.js').then((r) => 'ok:' + r.status, () => 'blocked')`),
      'blocked',
      'toggle on resumes blocking'
    )
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
