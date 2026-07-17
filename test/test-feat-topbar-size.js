const assert = require('assert')
const { launch, waitFor } = require('./harness')

const reloadWith = (patch) => `
  fs.writeFileSync(userDataFile('config.json'), JSON.stringify({ ...config, ...${JSON.stringify(patch)} }))
  runCommand('app-reload-config'); 0`

async function main() {
  const app = await launch()
  try {
    assert.equal(await app.evalMain('paneArea().y'), 36)

    await app.evalMain(reloadWith({ topBarHeight: 48, topBarFontSize: 14 }))
    await app.settle(300)

    assert.equal(await app.evalMain('paneArea().y'), 48, 'panes start below the taller bar')
    await waitFor(app, async () =>
      (await app.evalIn('chrome', `document.getElementById('statusbar').style.height`)) === '48px', 'bar height applied')
    assert.equal(await app.evalIn('chrome', 'document.body.style.fontSize'), '14px', 'bar text size applied')

    await app.evalMain(reloadWith({ topBarHeight: 999 }))
    await app.settle(200)
    assert.equal(await app.evalMain('paneArea().y'), 36, 'out-of-range height falls back to default')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
