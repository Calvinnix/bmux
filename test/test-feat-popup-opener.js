const assert = require('assert')
const { launch, waitFor, startServer } = require('./harness')

async function main() {
  const server = await startServer({
    '/parent': '<title>parent</title><button>open</button>',
    '/child': `<title>child</title><script>
      if (window.opener) window.opener.postMessage('hello-from-child', '*')
    </script>`,
  })
  const app = await launch()
  try {
    await app.evalMain(`activePane().view.webContents.loadURL('${server.url}/parent'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes[0].url.endsWith('/parent'), 'parent page')

    await app.evalIn('active', `
      window.__gotMessage = null
      addEventListener('message', (e) => { window.__gotMessage = e.data })
      window.__popup = window.open('${server.url}/child', 'oauth', 'width=400,height=500')
      !!window.__popup
    `).then((opened) => assert.equal(opened, true, 'window.open returns a live handle (was null before)'))

    await waitFor(app, async () => (await app.state()).tabs.length === 2, 'popup landed as a tab')
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs[s.activeTabIndex].panes[0].url.endsWith('/child')
    }, 'popup pane loaded the child url')

    assert.equal(await app.evalIn('active', '!!window.opener'), true, 'popup keeps window.opener (OAuth postMessage works)')

    await app.evalMain('selectTab(0); 0')
    await waitFor(app, async () => (await app.evalIn('active', 'window.__gotMessage')) === 'hello-from-child', 'child postMessage reached the opener')

    await app.evalMain('selectTab(1); 0')
    await app.evalIn('active', 'window.close(); 0').catch(() => {})
    await waitFor(app, async () => (await app.state()).tabs.length === 1, 'self-closing popup removes its tab')
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
