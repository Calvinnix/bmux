const assert = require('assert')
const { launch, waitFor } = require('./harness')

const cmd = (key, extra = {}) =>
  JSON.stringify({ key, code: '', shift: false, control: false, alt: false, meta: false, ...extra })

async function main() {
  const app = await launch()
  try {
    await app.settle(300)
    await app.evalMain(`Object.getPrototypeOf(activePane().view.webContents).focus = function () {}; 0`)

    await app.evalMain(`splitActive('row'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes.length === 2, 'split')
    const ids = await app.evalMain('leafIds(activeTab().root)')
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[1])

    await app.evalMain(`runPrefixCommand(${cmd('h', { code: 'KeyH' })}); 0`)
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[0], 'focus left')

    await app.evalMain(`panes.get(${JSON.stringify(ids[1])}).view.webContents.emit('focus'); 0`)
    assert.equal(
      await app.evalMain('activeTab().activePaneId'), ids[0],
      'a stale focus ack from an earlier programmatic focus must not steal the active pane'
    )

    await app.evalMain(`runPrefixCommand(${cmd(';')}); 0`)
    assert.equal(await app.evalMain('activeTab().activePaneId'), ids[1], 'prefix ; still returns to last pane')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
