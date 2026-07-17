const assert = require('assert')
const { launch, waitFor } = require('./harness')

const prefsReady = (app) => async () =>
  (await app.evalIn('prefs', 'document.readyState').catch(() => null)) === 'complete'

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`config.keybindings = [
      { key: 'n', alt: true, command: 'privacy-clear-site-data' },
      { key: 'p', alt: true, command: 'pane-join' },
    ]; 0`)
    await app.evalMain(`runCommand('app-preferences'); 0`)
    await waitFor(app, prefsReady(app), 'settings open')
    await waitFor(app, async () =>
      (await app.evalIn('prefs', `document.querySelectorAll('.binding').length`).catch(() => 0)) >= 2, 'bindings rendered')

    const overflow = await app.evalIn('prefs', `(() => {
      const d = document.documentElement
      const widest = Math.max(...[...document.querySelectorAll('*')].map((el) => el.getBoundingClientRect().right))
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, widest: Math.round(widest), innerW: innerWidth }
    })()`)
    assert.ok(
      overflow.scrollW <= overflow.clientW && overflow.widest <= overflow.innerW + 1,
      `settings must not scroll horizontally (scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}, widest element at ${overflow.widest}px vs ${overflow.innerW}px viewport)`,
    )

    await app.key('Escape', [], 'prefs')
    await waitFor(app, async () => !(await prefsReady(app)()), 'Esc closes settings')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
