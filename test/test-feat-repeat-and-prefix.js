const assert = require('assert')
const { launch, waitFor } = require('./harness')

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`splitActive('row'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes.length === 2, 'split')

    assert.equal(await app.evalMain('activeTab().root.ratio'), 0.5)
    await app.prefix('H', ['shift'])
    await app.settle(150)
    const afterOne = await app.evalMain('activeTab().root.ratio')
    assert.notEqual(afterOne, 0.5, 'prefix H resizes')
    assert.equal((await app.state()).repeatPending, true, 'repeat window armed after resize')

    await app.key('H', ['shift'])
    await app.settle(150)
    const afterTwo = await app.evalMain('activeTab().root.ratio')
    assert.notEqual(afterTwo, afterOne, 'H repeats without re-typing the prefix')

    await app.settle(900)
    assert.equal((await app.state()).repeatPending, false, 'repeat window expires')

    await app.key('b', ['control'])
    await app.settle(3400)
    assert.equal((await app.state()).prefixPending, true, 'prefix no longer times out by default')
    await app.key('h')
    await app.settle(150)
    const s = await app.state()
    assert.equal(s.prefixPending, false)
    assert.equal(s.tabs[0].activePaneId, (await app.evalMain('leafIds(activeTab().root)'))[0], 'prefix h focused left pane after long pause')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
