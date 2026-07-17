const assert = require('assert')
const { launch, waitFor } = require('./harness')

async function main() {
  const app = await launch()
  try {
    const firstPaneId = (await app.evalMain('[...panes.keys()][0]'))
    assert.equal(await app.evalMain(`panes.get(${firstPaneId}).view.getVisible()`), true)

    await app.evalMain('createMainWindow(nextSessionName()); 0')
    await waitFor(app, async () => (await app.evalMain('winContexts.size')) === 2, 'second window')
    await app.settle(400)

    const firstVisible = await app.evalMain(`panes.get(${firstPaneId}).view.getVisible()`)
    assert.equal(
      firstVisible, true,
      'opening a second window hid the first window\'s panes (both windows are on screen)',
    )

    const secondPaneId = await app.evalMain('activeTab().activePaneId')
    assert.equal(await app.evalMain(`panes.get(${secondPaneId}).view.getVisible()`), true)
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
