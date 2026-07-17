const assert = require('assert')
const { launch, waitFor } = require('./harness')

const cmd = (key, extra = {}) =>
  JSON.stringify({ key, code: '', shift: false, control: false, alt: false, meta: false, ...extra })

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`splitActive('row'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes.length === 2, 'split')
    const ids = await app.evalMain('leafIds(activeTab().root)')

    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[1])
    await app.evalMain(`runPrefixCommand(${cmd('h', { code: 'KeyH' })}); 0`)
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[0], 'focus left')
    await app.evalMain(`runPrefixCommand(${cmd(';')}); 0`)
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[1], 'prefix ; returns to last pane')
    await app.evalMain(`runPrefixCommand(${cmd(';')}); 0`)
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[0], 'prefix ; toggles')

    await app.evalMain(`runPrefixCommand(${cmd('{', { shift: true })}); 0`)
    const swapped = await app.evalMain('leafIds(activeTab().root)')
    assert.deepEqual(swapped, [ids[1], ids[0]], 'prefix { swaps panes')

    await app.evalMain('activeTab().root.ratio = 0.8; applyLayout(); 0')
    await app.evalMain(`runPrefixCommand(${cmd(' ')}); 0`)
    assert.equal(await app.evalMain('activeTab().root.ratio'), 0.5, 'prefix Space equalizes')

    await app.evalMain(`runPrefixCommand(${cmd('q', { code: 'KeyQ' })}); 0`)
    await waitFor(app, async () => (await app.state()).overlayMode === 'panes', 'display-panes overlay')
    await app.key('2', [], 'overlay')
    await waitFor(app, async () => (await app.state()).overlayMode === null, 'overlay closed')
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[0], 'display-panes digit jumps to pane 2 (swapped order)')

    await app.evalMain(`runPrefixCommand(${cmd('!', { shift: true })}); 0`)
    await waitFor(app, async () => (await app.state()).tabs.length === 2, 'break pane to tab')
    assert.equal((await app.state()).tabs[1].panes.length, 1)

    await app.evalMain('joinPaneIntoTab(0); 0')
    await waitFor(app, async () => (await app.state()).tabs.length === 1, 'join pane back')
    assert.equal((await app.state()).tabs[0].panes.length, 2, 'joined as split')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
