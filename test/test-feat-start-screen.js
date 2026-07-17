const assert = require('assert')
const { launch, waitFor, startServer } = require('./harness')

const press = (key) => `document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key })})); 0`

async function main() {
  const server = await startServer({ '/direct': '<title>DIRECT</title>ok', '/search': '<title>SEARCHED</title>ok' })
  const app = await launch()
  try {
    // ---- top bar shows a clickable address placeholder on the empty start page ----
    assert.equal(
      await app.evalIn('chrome', `document.getElementById('url').textContent`),
      '⌘L search or enter address', 'top bar shows an address placeholder when the URL is empty')
    assert.equal(await app.evalIn('chrome', `document.getElementById('url').classList.contains('placeholder')`), true)

    // ---- dashboard renders (ascii art, menu) and the gated bridge is present ----
    assert.ok(await app.evalIn('active', `!!document.querySelector('.art')`), 'ascii-art header renders')
    assert.equal(await app.evalIn('active', `typeof window.bmuxStart`), 'object', 'bmux:// pages get the action bridge')

    // ---- keyboard-driven selection: j moves the cursor ----
    assert.equal(await app.evalIn('active', `document.querySelector('.item.sel .text').textContent`), 'Open URL or search', 'first item selected on load')
    await app.evalIn('active', press('j'))
    assert.equal(await app.evalIn('active', `document.querySelector('.item.sel .text').textContent`), 'Find tab', 'j moves the selection down')

    // ---- a hotkey launches a bmux action through the bridge ----
    await app.evalIn('active', press('u'))
    await waitFor(app, async () => (await app.state()).overlayMode === 'history', 'hotkey u opened the history finder via the bridge')
    await app.key('Escape', [], 'overlay')
    await waitFor(app, async () => (await app.state()).overlayMode === null, 'finder closed')

    // ---- the bridge is NOT exposed to ordinary web pages ----
    await app.evalMain(`activePane().view.webContents.loadURL('${server.url}/direct'); 0`)
    await waitFor(app, async () => (await app.evalMain('activePane().view.webContents.getURL()')).includes('/direct'), 'left the start page')
    assert.equal(await app.evalIn('active', `typeof window.bmuxStart`), 'undefined', 'the bridge is scoped to bmux:// pages only')

    // ---- jump-back list populates and a number hotkey navigates ----
    await app.evalMain(`
      for (let i = 0; i < 4; i++) recordHistory('https://news.ycombinator.com/', 'Hacker News')
      closedTabs.push({ root: { type: 'leaf', url: '${server.url}/direct', paneId: 999 }, customName: null })
      activePane().view.webContents.loadURL('bmux://start'); 0
    `)
    await waitFor(app, async () => (await app.evalIn('active', `[...document.querySelectorAll('.group-title')].some((e) => e.textContent === 'Jump back in')`)) === true, 'jump-back section renders')
    await app.evalIn('active', press('1'))
    await waitFor(app, async () => !(await app.evalMain('activePane().view.webContents.getURL()')).startsWith('bmux://'), 'number hotkey navigates to a jump entry')

    // ---- search box: URL passthrough ----
    await app.evalMain(`activePane().view.webContents.loadURL('bmux://start'); 0`)
    await app.settle(400)
    await app.evalIn('active', `const s = document.getElementById('search'); s.focus(); s.value = '${server.url}/direct'; s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); 0`)
    await waitFor(app, async () => (await app.evalMain('activePane().view.webContents.getTitle()')) === 'DIRECT', 'search box navigates to a typed URL')

    // ---- search box: a query routes through the configured search engine ----
    await app.evalMain(`config.searchUrl = '${server.url}/search?q=%s'; activePane().view.webContents.loadURL('bmux://start'); 0`)
    await app.settle(400)
    await app.evalIn('active', `const s = document.getElementById('search'); s.focus(); s.value = 'hello world'; s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); 0`)
    await waitFor(app, async () => (await app.evalMain('activePane().view.webContents.getURL()')).includes('/search?q=hello'), 'a non-URL query goes through searchUrl')

    // ---- data injection is well-formed ----
    await app.evalMain(`activePane().view.webContents.loadURL('bmux://start'); 0`)
    await app.settle(400)
    assert.ok(await app.evalIn('active', `Array.isArray(window.__BMUX.topSites) && typeof window.__BMUX.searchUrl === 'string'`), 'window.__BMUX payload is injected')
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
