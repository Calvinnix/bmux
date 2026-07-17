const assert = require('assert')
const { launch, waitFor, startServer } = require('./harness')

async function main() {
  const server = await startServer({
    '/outer': `<title>outer</title>
      <a href="/x1">one</a> <a href="/x2">two</a>
      <iframe src="/inner" style="width:400px;height:200px"></iframe>`,
    '/inner': `<a href="/y1">inner-one</a> <a href="/y2">inner-two</a>`,
    '/y1': '<title>clicked-inner</title>ok',
  })
  const app = await launch()
  try {
    await app.evalMain(`activePane().view.webContents.loadURL('${server.url}/outer'); 0`)
    await waitFor(app, async () => (await app.state()).tabs[0].panes[0].url.endsWith('/outer'), 'outer page')
    await app.settle(400)

    await app.evalMain('startHints(false)')
    await waitFor(app, async () => (await app.state()).hinting, 'hint mode on')
    const frameCount = await app.evalMain('hintMode.frames.length')
    assert.equal(frameCount, 2, `hints cover the iframe too (${frameCount} frames)`)

    const outerLabels = await app.evalIn('active', `[...document.querySelectorAll('#__bmux-hints span')].map((s) => s.textContent)`)
    assert.equal(outerLabels.length, 2, 'outer frame has 2 hint labels')
    const innerLabels = await app.evalMain(`hintMode.frames[1].executeJavaScript("[...document.querySelectorAll('#__bmux-hints span')].map((s) => s.textContent)", true)`)
    assert.equal(innerLabels.length, 2, 'inner frame has 2 hint labels')
    const overlap = outerLabels.filter((l) => innerLabels.includes(l))
    assert.equal(overlap.length, 0, `labels are disjoint across frames (overlap: ${overlap})`)

    for (const ch of innerLabels[0]) await app.key(ch)
    await waitFor(app, async () => !(await app.state()).hinting, 'hint accepted')
    await waitFor(app, async () => {
      const inner = await app.evalMain(`activePane().view.webContents.mainFrame.framesInSubtree.length > 1
        ? activePane().view.webContents.mainFrame.framesInSubtree[1].url
        : activePane().view.webContents.getURL()`)
      return inner.endsWith('/y1')
    }, 'iframe link was clicked')
  } finally {
    await app.close()
    await server.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
