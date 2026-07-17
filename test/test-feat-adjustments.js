const assert = require('assert')
const { launch, waitFor } = require('./harness')

async function main() {
  const app = await launch()
  try {
    // ---- top bar resize mode (C-b t then ⌘± / ⌘0) ----
    await app.evalMain('setBarMode(true); 0')
    assert.equal(await app.evalMain('barMode'), true, 'C-b t enters bar mode')
    await app.evalMain(`handleKey({ key: '=', code: 'Equal', control: false, alt: false, shift: false, meta: true }); 0`)
    const grown = await app.evalMain('[config.topBarHeight, config.topBarFontSize]')
    assert.ok(grown[0] > 36 && grown[1] > 11.5, `⌘+ grows bar proportionally (${grown})`)
    assert.equal(await app.evalMain('barMode'), true, 'bar mode is sticky across resizes')
    await app.evalMain(`handleKey({ key: '0', code: 'Digit0', control: false, alt: false, shift: false, meta: true }); 0`)
    assert.deepEqual(await app.evalMain('[config.topBarHeight, config.topBarFontSize]'), [36, 11.5], '⌘0 resets bar')
    await app.evalMain(`handleKey({ key: 'Escape', code: 'Escape', control: false, alt: false, shift: false, meta: false }); 0`)
    assert.equal(await app.evalMain('barMode'), false, 'Escape leaves bar mode')

    // ---- custom website actions (per-site script → clipboard, matched by URL) ----
    await app.evalMain(`newTab('data:text/html,<title>JIRA-123</title>hi'); 0`)
    await waitFor(app, async () => {
      const s = await app.state()
      return s.tabs.length === 2 && s.tabs.every((t) => t.panes.every((p) => p.url))
    }, 'action test tab loaded')
    await app.evalMain(`config.actions = [{
      name: 'copy title', match: 'data:*',
      key: { key: 'j', control: true, alt: true },
      script: "bmux.copy(document.title); bmux.notify('copied ' + document.title)"
    }]; 0`)
    await app.evalMain(`clipboard.writeText(''); 0`)
    await app.evalMain(`runCommand('action:0'); 0`)
    await waitFor(app, async () => (await app.evalMain('clipboard.readText()')) === 'JIRA-123', 'action script copied the page title')

    const inputJ = `{ key: 'j', code: 'KeyJ', control: true, alt: true, shift: false, meta: false }`
    assert.ok(await app.evalMain(`!!matchingAction(${inputJ}, false)`), 'action matches its key on a matching URL')
    await app.evalMain('selectTab(0); 0')
    assert.equal(await app.evalMain(`matchingAction(${inputJ}, false) || null`), null, 'action is inert on a non-matching URL')

    // ---- custom themes (UI chrome tokens) ----
    assert.equal(await app.evalMain(`resolveTheme().bg`), '#16161e', 'default theme is tokyonight')
    assert.equal(await app.evalMain(`config.theme = 'gruvbox'; resolveTheme().bg`), '#1d2021', 'named preset resolves')
    await app.evalMain(`config.theme = 'tokyonight'; config.themeColors = { accent: '#ff0000' }; broadcastTheme(); 0`)
    await waitFor(app, async () =>
      (await app.evalIn('chrome', `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)) === '#ff0000',
      'themeColors override reaches the top bar')

    // ---- which-key popup ----
    assert.equal(await app.evalMain(`config.whichKey = false; scheduleWhichKey(); whichKeyTimer`), null, 'disabling which-key skips the popup')
    await app.evalMain(`config.whichKey = true; config.whichKeyDelayMs = 0; 0`)
    await app.evalMain('setPrefixPending(true); 0')
    await waitFor(app, async () => (await app.evalIn('whichkey', `document.querySelectorAll('#grid .item').length`)) > 10, 'which-key lists prefix bindings')
    assert.equal(await app.evalIn('whichkey', `document.getElementById('prefix').textContent`), 'C-b', 'which-key shows the prefix label')
    await app.evalMain('setPrefixPending(false); 0')

    // ---- favicons ----
    assert.equal(
      await app.evalMain(`faviconByOrigin['https://ex.com'] = 'https://ex.com/i.png'; faviconFor('https://ex.com/page')`),
      'https://ex.com/i.png', 'captured favicon is reused per origin')
    assert.equal(await app.evalMain(`faviconFor('https://noicon.test/x')`), 'https://noicon.test/favicon.ico', 'falls back to /favicon.ico')
    assert.ok(await app.evalMain(`'favicon' in collectTabItems()[0]`), 'tab items carry a favicon field')
    assert.ok(await app.evalMain(`'favicon' in treeItems()[0]`), 'tree (C-b w) items carry a favicon field')

    // ---- devtools toggle (opened detached so it renders for a WebContentsView) ----
    await app.evalMain(`runCommand('page-devtools'); 0`)
    await waitFor(app, async () => (await app.evalMain(`activePane().view.webContents.isDevToolsOpened()`)) === true, 'devtools opens')
    assert.ok(await app.evalMain(`!!activePane().view.webContents.devToolsWebContents`), 'a devtools view exists')
    await app.evalMain(`runCommand('page-devtools'); 0`)
    await waitFor(app, async () => (await app.evalMain(`activePane().view.webContents.isDevToolsOpened()`)) === false, 'devtools toggles closed')
  } finally {
    await app.close()
  }
}

main().then(() => { console.log('ok'); process.exit(0) }, (err) => { console.error(err.message); process.exit(1) })
