const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { launch, waitFor, startServer } = require('./harness')

async function main() {
  const server = await startServer({
    '/a': '<title>page-a</title>A',
    '/b': '<title>page-b</title>B',
  })
  let app = await launch()
  const dir = app.dir
  try {
    await app.evalMain(`activePane().view.webContents.loadURL('${server.url}/a'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes[0].url.endsWith('/a'), 'page a')
    await app.evalMain(`activePane().view.webContents.loadURL('${server.url}/b'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes[0].url.endsWith('/b'), 'page b')

    await app.evalMain(`adjustZoomLevel(1); 0`)
    assert.equal(await app.evalMain('activePane().view.webContents.getZoomLevel()'), 1)

    await app.evalMain(`splitActive('row'); 0`)
    await app.evalMain(`newTab('${server.url}/a'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs[0].panes.length === 2 && s.tabs.every((t) => t.panes.every((p) => p.url))
    }, 'split + second tab')
    await app.evalMain('selectTab(0); 0')

    await app.evalMain('saveSession(); 0')
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'))
    let leafNode = saved.sessions.main.tabs[0].root
    while (leafNode.type !== 'leaf') leafNode = leafNode.a
    assert.ok(Array.isArray(leafNode.history) && leafNode.history.length >= 2, 'session stores the back/forward stack')

    await app.close()
    app = await launch({ userData: dir })
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs[0].panes.length === 2
    }, 'tabs and splits survive restart (boot used to clobber the session)')
    await waitFor(app, async () => (await app.state()).tabs[0].panes[0].url.endsWith('/b'), 'restored to page b')

    const firstLeafWc = 'panes.get(leafIds(activeTab().root)[0]).view.webContents'
    const canGoBack = await app.evalMain(`${firstLeafWc}.navigationHistory.canGoBack()`)
    assert.equal(canGoBack, true, 'restored pane can still go back')
    await app.evalMain(`${firstLeafWc}.navigationHistory.goBack(); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes[0].url.endsWith('/a'), 'back reaches page a')

    await waitFor(app, async () => (await app.evalMain('activePane().view.webContents.getZoomLevel()')) === 1, 'per-site zoom reapplied after restart')

    await app.evalMain('win.close(); 0')
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 5000)
      app.proc.once('exit', () => { clearTimeout(t); resolve() })
    })
    app = await launch({ userData: dir })
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs[0].panes.length === 2
    }, 'detach (close last window) must not clobber the session at quit')
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
