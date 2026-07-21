const assert = require('assert')
const { launch, waitFor } = require('./harness')
const pkg = require('../package.json')

async function main() {
  const app = await launch()
  try {
    const status = JSON.parse(await app.evalMain('JSON.stringify(updater.status())'))
    assert.equal(status.state, 'disabled', 'updater is disabled under BMUX_DEBUG')
    assert.equal(status.version, pkg.version, 'status reports the app version')
    assert.equal(await app.evalMain('updater.describe()'), 'auto-updates off — debug mode')

    const ids = await app.evalMain('JSON.stringify(commandList().map((c) => c.id))')
    assert.ok(ids.includes('app-check-updates'), 'palette has app: check for updates')

    await app.evalMain(`runCommand('app-check-updates'); 0`)
    await waitFor(app, async () => {
      const msg = await app.evalMain('statusMsg')
      return typeof msg === 'string' && msg.includes('auto-updates off — debug mode')
    }, 'check command reports why updates are off')

    await app.evalMain(`runCommand('app-restart-update'); 0`)
    await waitFor(app, async () => {
      const msg = await app.evalMain('statusMsg')
      return typeof msg === 'string' && msg.includes('no update ready to install')
    }, 'restart command reports nothing to install')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
