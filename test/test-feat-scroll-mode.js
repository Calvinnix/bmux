const assert = require('assert')
const { launch, waitFor } = require('./harness')

const TALL_PAGE = 'data:text/html,<title>tall</title><body>' +
  encodeURIComponent(Array.from({ length: 400 }, (_, i) => `<p>paragraph number ${i}</p>`).join(''))

const cmd = (key, extra = {}) =>
  JSON.stringify({ key, code: '', shift: false, control: false, alt: false, meta: false, ...extra })

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`activePane().view.webContents.loadURL('${TALL_PAGE}'); 0`)
    await waitFor(app, async () => (await app.evalIn('active', 'document.body && document.body.scrollHeight')) > 2000, 'tall page')

    await app.prefix('v')
    await waitFor(app, async () => (await app.state()).scrolling, 'scroll mode on')

    await app.key('d')
    await app.settle(200)
    const afterHalfPage = await app.evalIn('active', 'scrollY')
    assert.ok(afterHalfPage > 100, `d scrolls half page (scrollY=${afterHalfPage})`)

    await app.key('j')
    await app.settle(200)
    assert.ok((await app.evalIn('active', 'scrollY')) > afterHalfPage, 'j scrolls down a line')

    await app.key('G', ['shift'])
    await app.settle(200)
    const atBottom = await app.evalIn('active', 'scrollY + innerHeight >= document.body.scrollHeight - 5')
    assert.ok(atBottom, 'G goes to bottom')

    await app.key('g')
    await app.key('g')
    await app.settle(200)
    assert.equal(await app.evalIn('active', 'scrollY'), 0, 'gg goes to top')

    await app.key('v')
    await waitFor(app, async () => (await app.state()).visual, 'visual mode')
    for (let i = 0; i < 4; i++) await app.key('w')
    await app.settle(300)
    const selected = await app.evalIn('active', 'getSelection().toString()')
    assert.ok(selected.length > 3, `visual w extends selection (got ${JSON.stringify(selected)})`)

    await app.evalMain(`clipboard.writeText(''); 0`)
    await app.key('y')
    await app.settle(300)
    const s = await app.state()
    assert.equal(s.scrolling, false, 'y exits scroll mode')
    const clip = await app.evalMain('clipboard.readText()')
    assert.equal(clip, selected, 'y yanked the selection to the clipboard')

    await app.prefix('v')
    await waitFor(app, async () => (await app.state()).scrolling, 'scroll mode again')
    await app.key('q')
    await waitFor(app, async () => !(await app.state()).scrolling, 'q exits scroll mode')

    await app.evalMain(`newTab('data:text/html,<title>other</title>x'); 0`)
    await waitFor(app, async () => (await app.state()).tabs.length === 2, 'second tab')
    await app.evalMain('selectTab(0); 0')
    await app.prefix('v')
    await waitFor(app, async () => (await app.state()).scrolling, 'scroll mode on tab 1')
    await app.key('Tab', ['control'])
    await waitFor(app, async () => (await app.state()).activeTabIndex === 1, 'Ctrl+Tab still switches tabs in scroll mode')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
