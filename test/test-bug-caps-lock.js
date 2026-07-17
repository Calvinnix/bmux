const assert = require('assert')
const { launch, waitFor } = require('./harness')

async function main() {
  const app = await launch()
  try {
    await app.evalMain(`splitActive('row'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes.length === 2, 'split')

    const before = await app.evalMain(
      `(() => { const t = activeTab(); return { active: t.activePaneId, ids: leafIds(t.root), ratio: t.root.ratio } })()`,
    )
    assert.equal(before.active, before.ids[1], 'split focuses the new right pane')

    const capsLockH = { key: 'H', code: 'KeyH', shift: false, control: false, alt: false, meta: false }
    await app.evalMain(`runPrefixCommand(${JSON.stringify(capsLockH)}); 0`)

    const after = await app.evalMain(
      `(() => { const t = activeTab(); return { active: t.activePaneId, ratio: t.root.ratio } })()`,
    )
    assert.equal(after.ratio, before.ratio, `caps-lock h resized instead of moving focus (ratio ${before.ratio} -> ${after.ratio})`)
    assert.equal(after.active, before.ids[0], 'caps-lock h should focus the left pane')

    const shiftH = { key: 'H', code: 'KeyH', shift: true, control: false, alt: false, meta: false }
    await app.evalMain(`runPrefixCommand(${JSON.stringify(shiftH)}); 0`)
    const resized = await app.evalMain(`activeTab().root.ratio`)
    assert.notEqual(resized, before.ratio, 'real shift+H must still resize')

    const dvorakX = { key: 'x', code: 'KeyB', shift: false, control: false, alt: false, meta: false }
    await app.evalMain(`runPrefixCommand(${JSON.stringify(dvorakX)}); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes.length === 1,
      'non-QWERTY layouts must dispatch on the typed key (x closes the pane), not the physical code')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
