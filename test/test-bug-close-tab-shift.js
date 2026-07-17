const assert = require('assert')
const { launch, waitFor } = require('./harness')

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`newTab('data:text/html,<title>tabB</title>B'); 0`)
    await app.evalMain(`newTab('data:text/html,<title>tabC</title>C'); 0`)
    await app.evalMain(`newTab('data:text/html,<title>tabD</title>D'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 4 && s.tabs.every((t) => t.panes.every((p) => p.url))
    }, '4 tabs loaded')

    await app.evalMain('selectTab(2); 0')
    let s = await app.state()
    assert.equal(s.activeTabIndex, 2)
    const activeUrl = s.tabs[2].panes[0].url
    assert.ok(activeUrl.includes('tabC'), `expected tabC active, got ${activeUrl}`)

    await app.evalIn('chrome', `window.bmux.send('chrome:close-tab', { index: 0 }); 0`)
    await waitFor(app, async () => (await app.state()).tabs.length === 3, 'tab closed')

    s = await app.state()
    const nowActive = s.tabs[s.activeTabIndex].panes[0].url
    assert.ok(
      nowActive.includes('tabC'),
      `active tab shifted after closing an earlier tab: expected tabC to stay active, got ${nowActive}`,
    )

    await app.evalMain('selectTab(0); 0')
    await app.evalMain(`runPrefixCommand({ key: 'Tab', code: 'Tab', shift: false, control: false, alt: false, meta: false }); 0`)
    s = await app.state()
    const lastTabUrl = s.tabs[s.activeTabIndex].panes[0].url
    assert.ok(
      lastTabUrl.includes('tabC'),
      `prefix Tab (last tab) went stale after close: expected tabC, got ${lastTabUrl}`,
    )
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
