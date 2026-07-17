const assert = require('assert')
const { launch, waitFor } = require('./harness')

const cmd = (key, extra = {}) =>
  JSON.stringify({ key, code: '', shift: false, control: false, alt: false, meta: false, ...extra })

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`newTab('data:text/html,<title>tabB</title>B'); 0`)
    await app.evalMain(`newTab('data:text/html,<title>tabC</title>C'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 3 && s.tabs.every((t) => t.panes.every((p) => p.url))
    }, '3 tabs')

    await app.evalMain(`runPrefixCommand(${cmd('<', { shift: true })}); 0`)
    let s = await app.state()
    assert.equal(s.activeTabIndex, 1, 'prefix < moves tab left')
    assert.ok(s.tabs[1].panes[0].url.includes('tabC'))

    await app.evalMain(`runPrefixCommand(${cmd('>', { shift: true })}); 0`)
    s = await app.state()
    assert.equal(s.activeTabIndex, 2, 'prefix > moves it back')

    await app.evalMain(`runPrefixCommand(${cmd('.')}); 0`)
    await waitFor(app, async () => (await app.state()).overlayMode === 'input', 'move-to prompt')
    await app.evalIn('overlay', `window.bmux.send('overlay:action', { mode: 'input', tag: 'tab-move', query: '1' }); 0`)
    await app.settle(200)
    s = await app.state()
    assert.equal(s.activeTabIndex, 0, 'prefix . moves tab to position 1')
    assert.ok(s.tabs[0].panes[0].url.includes('tabC'))

    await app.evalMain(`runPrefixCommand(${cmd('&', { shift: true })}); 0`)
    await waitFor(app, async () => (await app.state()).tabs.length === 2, 'prefix & closes tab')

    await app.evalMain(`runPrefixCommand(${cmd(',')}); 0`)
    await waitFor(app, async () => (await app.state()).overlayMode === 'input', 'rename prompt')
    await app.evalIn('overlay', `window.bmux.send('overlay:action', { mode: 'input', tag: 'rename', query: 'renamed!' }); 0`)
    await app.settle(200)
    assert.ok((await app.state()).tabs.some((t) => t.name === 'renamed!'), 'prefix , renames tab')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
