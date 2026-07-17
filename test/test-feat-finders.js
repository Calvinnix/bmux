const assert = require('assert')
const { launch, waitFor, startServer } = require('./harness')

async function main() {
  const server = await startServer({ '/paste-target': '<title>pasted</title>arrived' })
  const app = await launch()
  try {
    const multi = await app.evalIn('overlay', `fuzzyMatch('doc work', 'work/docs — Design docs') !== null`)
    assert.equal(multi, true, 'space-separated terms AND-match in any order')
    const miss = await app.evalIn('overlay', `fuzzyMatch('doc zzz', 'work/docs — Design docs')`)
    assert.equal(miss, null, 'all terms must match')

    await app.evalMain(`
      recordHistory('https://rare.example.com/x', 'rare page')
      for (let i = 0; i < 6; i++) recordHistory('https://often.example.com/y', 'often page')
      addMark('my mark', 'https://marked.example.com/z', 'tags')
      0
    `)
    const suggestions = await app.evalMain('openSuggestions().map((s) => ({ kind: s.kind, url: s.url }))')
    const urls = suggestions.map((s) => s.url)
    assert.ok(urls.includes('https://marked.example.com/z'), 'bookmarks appear in open prompt')
    assert.ok(urls.includes('https://often.example.com/y'), 'history appears in open prompt')
    assert.equal(new Set(urls).size, urls.length, 'suggestions are deduped')
    const often = await app.evalMain(`frecency(history.find((h) => h.url.includes('often')))`)
    const rare = await app.evalMain(`frecency(history.find((h) => h.url.includes('rare')))`)
    assert.ok(often > rare, `frecency favors repeat visits (${often} vs ${rare})`)

    await app.evalMain(`newTab('data:text/html,<title>opentabtest</title>hello'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs.every((t) => t.panes.every((p) => p.url))
    }, 'second tab loaded')
    await app.evalMain('selectTab(0); 0')
    const tabFirst = await app.evalMain(`openSuggestions()[0].kind`)
    assert.equal(tabFirst, 'tab', 'open tabs rank first in suggestions')

    const before = (await app.state()).tabs.length
    await app.evalMain(`runPrefixCommand({ key: 'c', code: 'KeyC', shift: false, control: false, alt: false, meta: false }); 0`)
    await waitFor(app, async () => (await app.state()).tabs.length === before + 1, 'prefix c creates a tab directly')
    assert.equal((await app.state()).overlayMode, null, 'new tab is created immediately, without a chooser')
    await waitFor(app, async () =>
      (await app.evalMain(`panes.get(activeTab().activePaneId).view.webContents.getURL()`)).startsWith('bmux://start'),
      'new tab opens the homepage')

    await app.evalMain('selectTab(0); 0')
    const openTabPane = await app.evalMain(`openSuggestions().find((s) => s.kind === 'tab').paneId`)
    const tabCount = (await app.state()).tabs.length
    await app.evalMain(`openFinder('open', { newTab: true, value: '' }); 0`)
    await app.evalIn('overlay', `window.bmux.send('overlay:action', { mode: 'open', item: { kind: 'tab', paneId: ${openTabPane}, url: 'x' }, query: '', newTab: true }); 0`)
    await app.settle(300)
    const s2 = await app.state()
    assert.equal(s2.tabs.length, tabCount, 'selecting an open-tab suggestion switches instead of duplicating')
    assert.equal(s2.tabs[s2.activeTabIndex].activePaneId, openTabPane, 'focus moved to the existing pane')

    await app.evalMain(`clipboard.writeText('${server.url}/paste-target'); 0`)
    await app.evalMain(`runCommand('open-clipboard'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs[s.activeTabIndex].panes.some((p) => p.url.includes('/paste-target'))
    }, 'paste-and-go navigates')

    await app.evalMain(`downloads.unshift({ name: 'fake.pdf', url: 'https://x/fake.pdf', file: '/tmp/fake.pdf', state: 'completed', ts: 1 }); 0`)
    await app.evalMain(`openFinder('downloads'); 0`)
    await waitFor(app, async () => (await app.state()).overlayMode === 'downloads', 'downloads finder')
    const rows = await app.evalIn('overlay', `document.querySelectorAll('.row').length`)
    assert.ok(rows >= 1, 'downloads finder lists entries')
    await app.key('Escape', [], 'overlay')
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
