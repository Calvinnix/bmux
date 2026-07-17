const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { launch, waitFor, startServer } = require('./harness')

async function main() {
  const server = await startServer({ '/secret': '<title>secret</title>S' })
  const app = await launch()
  try {
    assert.equal(await app.evalMain(`zoomKey('file:///a/b.html')`), 'file:', 'file urls get a scheme zoom key')
    assert.equal(await app.evalMain(`zoomKey('https://x.example.com/p')`), 'x.example.com')

    await app.evalMain(`newTab('${server.url}/secret', true); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs[1].panes[0].url.endsWith('/secret')
    }, 'private tab loaded')

    await app.evalMain('adjustZoomLevel(1); 0')
    assert.equal(await app.evalMain('activePane().view.webContents.getZoomLevel()'), 1, 'zoom applies in private tab')
    assert.equal(await app.evalMain('JSON.stringify(zoomLevels)'), '{}', 'private-tab zoom is never persisted')

    await app.evalMain(`downloads.unshift({ name: 's.pdf', url: '${server.url}/s.pdf', file: '/tmp/s.pdf', state: 'completed', ts: 1, private: true }); saveDownloads(); 0`)
    await app.settle(200)
    const onDisk = JSON.parse(fs.readFileSync(path.join(app.dir, 'downloads.json'), 'utf8'))
    assert.equal(onDisk.length, 0, 'private downloads are not written to downloads.json')
    assert.equal(await app.evalMain('downloads.length'), 1, 'private downloads still visible in-session')
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
