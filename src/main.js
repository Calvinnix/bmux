const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session, protocol, net, shell, clipboard, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const hints = require('./hints')
const bookmarkSources = require('./bookmarks')
const updater = require('./updater')
const { initBlocking, applyEngine } = require('./blocking')

if (process.env.BMUX_USER_DATA) app.setPath('userData', process.env.BMUX_USER_DATA)

const DEFAULT_BAR_HEIGHT = 36
const DEFAULT_BAR_FONT = 11.5

function statusBarHeight() {
  const h = Number(config.topBarHeight)
  return h >= 24 && h <= 80 ? Math.round(h) : DEFAULT_BAR_HEIGHT
}

function statusBarFontSize() {
  const s = Number(config.topBarFontSize)
  return s >= 9 && s <= 24 ? s : DEFAULT_BAR_FONT
}
const PANE_BORDER = 4
const RESIZE_STEP = 0.05
const HISTORY_LIMIT = 5000
const GREP_MAX_LINES_PER_PANE = 3000

const DEFAULT_CONFIG = {
  prefix: { key: 'b', control: true, alt: false, shift: false },
  searchUrl: 'https://duckduckgo.com/?q=%s',
  homepage: 'bmux://start',
  blockTrackers: true,
  blockExtra: [],
  appearance: 'system',
  keybindings: [],
  prefixTimeoutMs: 0,
  repeatTimeMs: 600,
  topBarHeight: 36,
  topBarFontSize: 11.5,
  actions: [],
  theme: 'tokyonight',
  themeColors: {},
  whichKey: true,
  whichKeyDelayMs: 250,
}

const THEMES = {
  tokyonight: {
    bg: '#16161e', panel: '#1a1c28', fg: '#c0caf5', dim: '#565f89', faint: '#3b4261',
    accent: '#7aa2f7', border: '#262a40', 'input-bg': '#1d2030', 'sel-bg': '#1e2233', match: '#e0af68',
  },
  light: {
    bg: '#eaeaef', panel: '#e0e0e8', fg: '#33344a', dim: '#8288a8', faint: '#a8adc4',
    accent: '#3d59a1', border: '#c9cbd8', 'input-bg': '#f2f2f6', 'sel-bg': '#dcdde8', match: '#8f5e15',
  },
  gruvbox: {
    bg: '#1d2021', panel: '#282828', fg: '#ebdbb2', dim: '#928374', faint: '#665c54',
    accent: '#fabd2f', border: '#3c3836', 'input-bg': '#32302f', 'sel-bg': '#3c3836', match: '#fe8019',
  },
  nord: {
    bg: '#2e3440', panel: '#3b4252', fg: '#eceff4', dim: '#7b88a1', faint: '#4c566a',
    accent: '#88c0d0', border: '#434c5e', 'input-bg': '#3b4252', 'sel-bg': '#434c5e', match: '#ebcb8b',
  },
}

function resolveTheme() {
  const base = THEMES[config.theme] || THEMES.tokyonight
  return { ...base, ...(config.themeColors || {}) }
}

const TRACKER_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google.com', 'adnxs.com',
  'adsafeprotected.com', 'amazon-adsystem.com', 'connect.facebook.net', 'scorecardresearch.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'quantserve.com',
  'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com', 'moatads.com',
  'doubleverify.com', 'hotjar.com', 'mouseflow.com', 'fullstory.com', 'mixpanel.com',
  'amplitude.com', 'branch.io', 'chartbeat.com', 'bam.nr-data.net', 'mc.yandex.ru',
  'bat.bing.com', 'analytics.tiktok.com', 'static.ads-twitter.com', 'analytics.twitter.com',
  'px.ads.linkedin.com', 'snap.licdn.com', 'ct.pinterest.com', 'adroll.com', 'mathtag.com',
  'bluekai.com', 'krxd.net', 'demdex.net', 'omtrdc.net', 'everesttech.net', 'agkn.com',
  'sharethrough.com', 'smartadserver.com', 'teads.tv', 'yieldmo.com', '33across.com',
  'gumgum.com', 'bidswitch.net', 'adform.net', 'adsrvr.org', 'sonobi.com',
]

let config = DEFAULT_CONFIG
let win = null
let overlayView = null
let whichKeyView = null
let whichKeyTimer = null
let overlayMode = null
let tabs = []
let activeTabIndex = 0
let nextId = 1
let prefixPending = false
let prefixTimer = null
let repeatPending = false
let repeatTimer = null
let scrollMode = null
let barMode = false
let hintMode = null
let displayPanesTimer = null
let blockedCount = 0
let adblockReady = false
let statusTimer = null
let statusMsg = null
let statusMsgTimer = null
let history = []
let historySaveTimer = null
let marks = []
let downloads = []
let zoomLevels = {}
let currentSession = 'main'
let sessionStore = {}
let quitting = false
let closedTabs = []
const panes = new Map()
const faviconByOrigin = {}

function originOf(url) {
  try { return new URL(url).origin } catch { return '' }
}

function faviconFor(url) {
  const o = originOf(url)
  if (!o) return ''
  return faviconByOrigin[o] || (/^https?:/.test(o) ? o + '/favicon.ico' : '')
}

function userDataFile(name) {
  return path.join(app.getPath('userData'), name)
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function loadConfig() {
  const file = userDataFile('config.json')
  config = { ...DEFAULT_CONFIG, ...loadJson(file, {}) }
  if (!fs.existsSync(file)) {
    try { fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2)) } catch {}
  }
}

// ---------- history ----------

function loadHistory() {
  history = loadJson(userDataFile('history.json'), [])
}

function saveHistorySoon() {
  clearTimeout(historySaveTimer)
  historySaveTimer = setTimeout(() => saveJson('history.json', history), 1000)
}

function recordHistory(url, title) {
  if (!/^https?:/.test(url)) return
  const existing = history.find((h) => h.url === url)
  if (existing) {
    existing.ts = Date.now()
    existing.count = (existing.count || 1) + 1
    if (title) existing.title = title
  } else {
    history.push({ url, title: title || url, ts: Date.now(), count: 1 })
    if (history.length > HISTORY_LIMIT) {
      let oldest = 0
      for (let i = 1; i < history.length; i++) {
        if (history[i].ts < history[oldest].ts) oldest = i
      }
      history.splice(oldest, 1)
    }
  }
  saveHistorySoon()
}

function frecency(h) {
  const days = (Date.now() - h.ts) / 86400000
  const weight = days < 0.2 ? 100 : days < 1 ? 80 : days < 3 ? 60 : days < 7 ? 40 : days < 30 ? 20 : 10
  return (h.count || 1) * weight
}

// ---------- downloads / per-site zoom ----------

function saveJson(name, data) {
  try { fs.writeFileSync(userDataFile(name), JSON.stringify(data)) } catch {}
}

function loadDownloads() {
  downloads = loadJson(userDataFile('downloads.json'), [])
}

function saveDownloads() {
  saveJson('downloads.json', downloads.filter((d) => !d.private))
}

let zoomSaveTimer = null

function loadZoomLevels() {
  zoomLevels = loadJson(userDataFile('zoom.json'), {})
}

function saveZoomLevelsSoon() {
  clearTimeout(zoomSaveTimer)
  zoomSaveTimer = setTimeout(() => saveJson('zoom.json', zoomLevels), 500)
}

function hostOf(url) {
  try { return new URL(url).hostname } catch { return '' }
}

function zoomKey(url) {
  const host = hostOf(url)
  if (host) return host
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url || '')
  return scheme ? scheme[1] + ':' : ''
}

// ---------- bookmarks ----------

function loadMarks() {
  marks = loadJson(userDataFile('bookmarks.json'), [])
}

function saveMarks() {
  try { fs.writeFileSync(userDataFile('bookmarks.json'), JSON.stringify(marks, null, 1)) } catch {}
}

function parseMarkInput(raw, fallbackName) {
  const text = raw.trim()
  const slash = text.lastIndexOf('/')
  const tag = slash > 0 ? text.slice(0, slash).trim() : ''
  const name = (slash > 0 ? text.slice(slash + 1) : text).trim() || fallbackName
  return { tag, name }
}

function addMark(name, url, tag) {
  if (!url) return
  const existing = marks.find((m) => m.url === url)
  if (existing) {
    existing.name = name
    existing.tag = tag
    existing.ts = Date.now()
  } else {
    marks.push({ name, url, tag, ts: Date.now() })
  }
  saveMarks()
}

function mergeMarks(imported) {
  const seen = new Set(marks.map((m) => m.url))
  let added = 0
  for (const b of imported) {
    if (!b.url || seen.has(b.url)) continue
    seen.add(b.url)
    marks.push({ name: b.name, url: b.url, tag: b.tag || '', ts: Date.now() })
    added++
  }
  if (added) saveMarks()
  return added
}

function runImport(source) {
  try {
    const added = mergeMarks(bookmarkSources.importSource(source))
    openFinder('bookmarks', { notice: `imported ${added} new from ${source.label || source.kind}` })
  } catch (err) {
    openFinder('import', { notice: String(err.message || err) })
  }
}

// ---------- pane tree ----------

function leaf(paneId) {
  return { type: 'leaf', paneId }
}

function leafIds(node) {
  if (node.type === 'leaf') return [node.paneId]
  return [...leafIds(node.a), ...leafIds(node.b)]
}

function findParent(node, paneId, parent = null) {
  if (node.type === 'leaf') return node.paneId === paneId ? { node, parent } : null
  return findParent(node.a, paneId, node) || findParent(node.b, paneId, node)
}

function activeTab() {
  return tabs[activeTabIndex]
}

const pendingFocus = new Map()

function setActivePane(tab, paneId) {
  if (tab.activePaneId === paneId) return
  tab.lastPaneId = tab.activePaneId
  tab.activePaneId = paneId
}

function activePane() {
  const tab = activeTab()
  return tab ? panes.get(tab.activePaneId) : null
}

function tabOfPane(paneId) {
  return tabs.find((t) => leafIds(t.root).includes(paneId))
}

// ---------- pane / view creation ----------

function createPane(url, isPrivate = false, restore = null) {
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'pane-preload.js'),
      partition: isPrivate ? 'bmux-private' : 'persist:main',
    },
  })
  const wc = view.webContents
  const fallback = () => {
    try { wc.loadURL(url || config.homepage) } catch {}
  }
  const entries = (restore?.history || []).filter((e) => e && e.url)
  let restored = false
  if (entries.length && typeof wc.navigationHistory.restore === 'function') {
    try {
      const p = wc.navigationHistory.restore({
        entries,
        index: Math.min(Math.max(0, restore.historyIndex || 0), entries.length - 1),
      })
      if (p && typeof p.catch === 'function') p.catch(fallback)
      restored = true
    } catch {}
  }
  const pane = wirePane(view, isPrivate)
  if (!restored) fallback()
  return pane
}

function wirePane(view, isPrivate) {
  const id = nextId++
  if (typeof view.setBorderRadius === 'function') view.setBorderRadius(6)
  const pane = { id, view, isPrivate }
  panes.set(id, pane)
  const wc = view.webContents

  attachKeyRouter(wc)

  wc.setWindowOpenHandler((details) => {
    activateWindowOfPane(id)
    if (details.disposition === 'new-window') {
      return {
        action: 'allow',
        createWindow: (options) => createPopupPane(options, isPrivate).view.webContents,
      }
    }
    newTab(details.url, isPrivate)
    return { action: 'deny' }
  })

  wc.on('page-title-updated', (_e, title) => {
    if (!isPrivate) recordHistory(wc.getURL(), title)
    sendStatus()
  })
  wc.on('page-favicon-updated', (_e, favicons) => {
    const icon = (favicons || []).find((f) => f && f !== 'data:,') || ''
    pane.favicon = icon
    const o = originOf(wc.getURL())
    if (icon && o) faviconByOrigin[o] = icon
    sendStatus()
  })
  wc.on('did-navigate', (_e, target) => {
    if (!isPrivate) recordHistory(target, wc.getTitle())
    const level = zoomLevels[zoomKey(target)]
    if (wc.getZoomLevel() !== (level || 0)) wc.setZoomLevel(level || 0)
    saveSessionSoon()
    sendStatus()
  })
  wc.on('did-navigate-in-page', (_e, target, isMainFrame) => {
    if (isMainFrame && !isPrivate) recordHistory(target, wc.getTitle())
    sendStatus()
  })
  wc.on('did-start-loading', sendStatus)
  wc.on('did-stop-loading', sendStatus)
  wc.on('focus', () => {
    // acks of our own focusActivePane() calls can arrive after the active pane
    // has moved on; acting on them would steal focus back (and clobber lastPaneId)
    const pending = pendingFocus.get(id) || 0
    if (pending > 0) {
      pendingFocus.set(id, pending - 1)
      return
    }
    const tab = tabOfPane(id)
    if (tab && tab.activePaneId !== id) {
      setActivePane(tab, id)
      sendStatus()
    }
  })
  wc.on('found-in-page', (_e, result) => {
    overlaySend('find:result', { matches: result.matches, active: result.activeMatchOrdinal })
  })
  wc.on('context-menu', (_e, params) => buildContextMenu(wc, params).popup())
  wc.on('destroyed', () => removeDeadPane(id))

  win.contentView.addChildView(view)
  win.contentView.addChildView(overlayView)
  return pane
}

function activateWindowOfPane(paneId) {
  if (tabs.some((t) => leafIds(t.root).includes(paneId))) return
  for (const [w, s] of winContexts) {
    if (w === win || w.isDestroyed() || !s.tabs) continue
    if (s.tabs.some((t) => leafIds(t.root).includes(paneId))) {
      snapshotCurrent()
      restoreFrom(w)
      w.focus()
      return
    }
  }
}

function createPopupPane(options, isPrivate) {
  const view = new WebContentsView({
    webContents: options.webContents,
    webPreferences: { ...options.webPreferences },
  })
  const pane = wirePane(view, isPrivate)
  addTabForPane(pane, isPrivate)
  return pane
}

function destroyPane(pane) {
  panes.delete(pane.id)
  pendingFocus.delete(pane.id)
  win.contentView.removeChildView(pane.view)
  pane.view.webContents.close()
}

function removeDeadPane(paneId) {
  if (quitting) return
  const pane = panes.get(paneId)
  if (!pane) return
  panes.delete(paneId)
  pendingFocus.delete(paneId)
  const tab = tabs.find((t) => leafIds(t.root).includes(paneId))
  if (tab) {
    try { win?.contentView.removeChildView(pane.view) } catch {}
    if (detachLeafFromTab(tab, paneId)) {
      applyLayout()
      focusActivePane()
      saveSessionSoon()
    } else {
      closeTabShell(tabs.indexOf(tab))
    }
    return
  }
  for (const [w, s] of winContexts) {
    if (w === win || w.isDestroyed() || !s.tabs) continue
    const t = s.tabs.find((x) => leafIds(x.root).includes(paneId))
    if (!t) continue
    try { w.contentView.removeChildView(pane.view) } catch {}
    if (!detachLeafFromTab(t, paneId)) {
      const activeT = s.tabs[s.activeTabIndex]
      const lastT = s.tabs[s.lastTabIndex]
      const idx = s.tabs.indexOf(t)
      s.tabs.splice(idx, 1)
      s.activeTabIndex = activeT === t
        ? Math.max(0, Math.min(idx, s.tabs.length - 1))
        : Math.max(0, s.tabs.indexOf(activeT))
      s.lastTabIndex = Math.max(0, s.tabs.indexOf(lastT))
    }
    return
  }
}

function closeTabShell(index) {
  const tab = tabs[index]
  if (!tab) return
  const activeT = tabs[activeTabIndex]
  const lastT = tabs[lastTabIndex]
  tabs.splice(index, 1)
  if (tabs.length === 0) {
    newTab(config.homepage)
    return
  }
  activeTabIndex = activeT === tab
    ? Math.min(index, tabs.length - 1)
    : Math.max(0, tabs.indexOf(activeT))
  lastTabIndex = Math.max(0, tabs.indexOf(lastT))
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function buildContextMenu(wc, params) {
  const items = []
  if (params.linkURL) {
    items.push({ label: 'Open Link in New Tab', click: () => newTab(params.linkURL) })
    items.push({ type: 'separator' })
  }
  if (params.isEditable) {
    items.push({ role: 'cut' }, { role: 'paste' })
  }
  if (params.selectionText) items.push({ role: 'copy' })
  items.push(
    { type: 'separator' },
    { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Inspect Element', click: () => {
      if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' })
      wc.inspectElement(params.x, params.y)
    } },
  )
  return Menu.buildFromTemplate(items)
}

// ---------- tabs ----------

function addTabForPane(pane, isPrivate) {
  tabs.push({ root: leaf(pane.id), activePaneId: pane.id, customName: null, zoomed: false, isPrivate })
  lastTabIndex = activeTabIndex
  activeTabIndex = tabs.length - 1
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function newTab(url, isPrivate = false) {
  addTabForPane(createPane(url, isPrivate), isPrivate)
}

function closeTab(index) {
  const tab = tabs[index]
  if (!tab) return
  if (!tab.isPrivate) {
    closedTabs.push({ root: serializeNode(tab.root), customName: tab.customName })
    if (closedTabs.length > 20) closedTabs.shift()
  }
  for (const paneId of leafIds(tab.root)) destroyPane(panes.get(paneId))
  closeTabShell(index)
}

let lastTabIndex = 0

function selectTab(index) {
  if (index < 0 || index >= tabs.length || index === activeTabIndex) return
  lastTabIndex = activeTabIndex
  activeTabIndex = index
  applyLayout()
  focusActivePane()
}

function tabName(tab, index) {
  if (tab.customName) return tab.customName
  const pane = panes.get(tab.activePaneId)
  const title = pane ? pane.view.webContents.getTitle() : ''
  return (title || 'new tab').slice(0, 22)
}

// ---------- splits ----------

function splitActive(dir) {
  const tab = activeTab()
  if (!tab) return
  tab.zoomed = false
  const found = findParent(tab.root, tab.activePaneId)
  if (!found) return
  const currentUrl = panes.get(tab.activePaneId).view.webContents.getURL()
  const pane = createPane(currentUrl || config.homepage, tab.isPrivate)
  const split = { type: 'split', dir, ratio: 0.5, a: found.node, b: leaf(pane.id) }
  if (!found.parent) {
    tab.root = split
  } else if (found.parent.a === found.node) {
    found.parent.a = split
  } else {
    found.parent.b = split
  }
  setActivePane(tab, pane.id)
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function detachLeafFromTab(tab, paneId) {
  if (tab.root.type === 'leaf') return false
  const found = findParent(tab.root, paneId)
  if (!found || !found.parent) return tab.root.type !== 'leaf'
  const sibling = found.parent.a === found.node ? found.parent.b : found.parent.a
  const grand = findSplitParent(tab.root, found.parent)
  if (!grand) {
    tab.root = sibling
  } else if (grand.a === found.parent) {
    grand.a = sibling
  } else {
    grand.b = sibling
  }
  if (tab.activePaneId === paneId) setActivePane(tab, leafIds(sibling)[0])
  tab.zoomed = false
  return true
}

function closeActivePane() {
  const tab = activeTab()
  if (!tab) return
  const paneId = tab.activePaneId
  if (tab.root.type === 'leaf') {
    closeTab(activeTabIndex)
    return
  }
  destroyPane(panes.get(paneId))
  detachLeafFromTab(tab, paneId)
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function findSplitParent(node, target, parent = null) {
  if (node === target) return parent
  if (node.type === 'leaf') return null
  return findSplitParent(node.a, target, node) || findSplitParent(node.b, target, node)
}

function toggleZoom() {
  const tab = activeTab()
  if (!tab || tab.root.type === 'leaf') return
  tab.zoomed = !tab.zoomed
  applyLayout()
  focusActivePane()
}

function leafNodes(node) {
  if (node.type === 'leaf') return [node]
  return [...leafNodes(node.a), ...leafNodes(node.b)]
}

function swapActive(step) {
  const tab = activeTab()
  if (!tab) return
  const nodes = leafNodes(tab.root)
  if (nodes.length < 2) return
  const i = nodes.findIndex((n) => n.paneId === tab.activePaneId)
  const j = (i + step + nodes.length) % nodes.length
  ;[nodes[i].paneId, nodes[j].paneId] = [nodes[j].paneId, nodes[i].paneId]
  tab.zoomed = false
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function rotatePanes() {
  const tab = activeTab()
  if (!tab) return
  const nodes = leafNodes(tab.root)
  if (nodes.length < 2) return
  const ids = nodes.map((n) => n.paneId)
  nodes.forEach((n, i) => { n.paneId = ids[(i + 1) % ids.length] })
  tab.zoomed = false
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function breakPaneToTab() {
  const tab = activeTab()
  if (!tab || tab.root.type === 'leaf') return
  const paneId = tab.activePaneId
  detachLeafFromTab(tab, paneId)
  tabs.push({ root: leaf(paneId), activePaneId: paneId, customName: null, zoomed: false, isPrivate: tab.isPrivate })
  lastTabIndex = activeTabIndex
  activeTabIndex = tabs.length - 1
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function focusLastPane() {
  const tab = activeTab()
  if (!tab || !tab.lastPaneId) return
  if (!panes.has(tab.lastPaneId) || !leafIds(tab.root).includes(tab.lastPaneId)) return
  setActivePane(tab, tab.lastPaneId)
  tab.zoomed = false
  applyLayout()
  focusActivePane()
}

function moveTabTo(to) {
  const from = activeTabIndex
  if (to < 0 || to >= tabs.length || to === from) return
  const lastT = tabs[lastTabIndex]
  const [tab] = tabs.splice(from, 1)
  tabs.splice(to, 0, tab)
  activeTabIndex = to
  lastTabIndex = Math.max(0, tabs.indexOf(lastT))
  applyLayout()
  saveSessionSoon()
}

function moveTab(delta) {
  moveTabTo(activeTabIndex + delta)
}

function equalizeNode(node) {
  if (node.type === 'leaf') return 1
  const a = equalizeNode(node.a)
  const b = equalizeNode(node.b)
  node.ratio = a / (a + b)
  return a + b
}

function equalizeLayout() {
  const tab = activeTab()
  if (!tab || tab.root.type === 'leaf') return
  equalizeNode(tab.root)
  tab.zoomed = false
  applyLayout()
  saveSessionSoon()
}

function joinItems() {
  return tabs
    .map((t, i) => ({
      tabIndex: i,
      tag: `${i + 1}`,
      label: tabName(t, i) + (t.isPrivate ? '·P' : ''),
      url: panes.get(t.activePaneId)?.view.webContents.getURL() || '',
      panes: leafIds(t.root).length,
    }))
    .filter((it) => it.tabIndex !== activeTabIndex)
}

function joinPaneIntoTab(targetIndex) {
  const tab = activeTab()
  const target = tabs[targetIndex]
  if (!tab || !target || target === tab) return
  const paneId = tab.activePaneId
  if (!detachLeafFromTab(tab, paneId)) {
    const lastT = tabs[lastTabIndex]
    tabs.splice(tabs.indexOf(tab), 1)
    lastTabIndex = Math.max(0, tabs.indexOf(lastT))
  }
  const anchor = findParent(target.root, target.activePaneId)
  const split = { type: 'split', dir: 'col', ratio: 0.5, a: anchor.node, b: leaf(paneId) }
  if (!anchor.parent) target.root = split
  else if (anchor.parent.a === anchor.node) anchor.parent.a = split
  else anchor.parent.b = split
  setActivePane(target, paneId)
  target.zoomed = false
  activeTabIndex = tabs.indexOf(target)
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function openDisplayPanes() {
  const tab = activeTab()
  if (!tab) return
  const rects = currentLeafRects()
  if (rects.length < 2) return
  const items = rects.map((l, i) => ({
    n: i + 1,
    paneId: l.paneId,
    active: l.paneId === tab.activePaneId,
    x: l.rect.x,
    y: l.rect.y - statusBarHeight(),
    width: l.rect.width,
    height: l.rect.height,
  }))
  openFinder('panes', { items })
  clearTimeout(displayPanesTimer)
  const w = win
  displayPanesTimer = setTimeout(() => {
    if (win === w && overlayMode === 'panes') closeFinder()
  }, 2000)
}

// ---------- layout ----------

function layoutTree(node, rect, out) {
  if (node.type === 'leaf') {
    out.push({ paneId: node.paneId, rect })
    return
  }
  if (node.dir === 'row') {
    const aw = Math.round(rect.width * node.ratio)
    layoutTree(node.a, { ...rect, width: aw }, out)
    layoutTree(node.b, { ...rect, x: rect.x + aw, width: rect.width - aw }, out)
  } else {
    const ah = Math.round(rect.height * node.ratio)
    layoutTree(node.a, { ...rect, height: ah }, out)
    layoutTree(node.b, { ...rect, y: rect.y + ah, height: rect.height - ah }, out)
  }
}

function paneArea() {
  const [cw, ch] = win.getContentSize()
  const h = statusBarHeight()
  return { x: 0, y: h, width: cw, height: ch - h }
}

function currentLeafRects() {
  const tab = activeTab()
  if (!tab) return []
  const area = paneArea()
  if (tab.zoomed) return [{ paneId: tab.activePaneId, rect: area }]
  const out = []
  layoutTree(tab.root, area, out)
  return out
}

let dividerSegments = []

function collectDividers(node, rect, out) {
  if (node.type === 'leaf') return
  if (node.dir === 'row') {
    const aw = Math.round(rect.width * node.ratio)
    out.push({ node, rect, axis: 'row', x: rect.x + aw, y: rect.y, length: rect.height })
    collectDividers(node.a, { ...rect, width: aw }, out)
    collectDividers(node.b, { ...rect, x: rect.x + aw, width: rect.width - aw }, out)
  } else {
    const ah = Math.round(rect.height * node.ratio)
    out.push({ node, rect, axis: 'col', x: rect.x, y: rect.y + ah, length: rect.width })
    collectDividers(node.a, { ...rect, height: ah }, out)
    collectDividers(node.b, { ...rect, y: rect.y + ah, height: rect.height - ah }, out)
  }
}

function applyLayout() {
  if (!win) return
  const tab = activeTab()
  const placed = new Set()
  if (tab) {
    for (const { paneId, rect } of currentLeafRects()) {
      const pane = panes.get(paneId)
      pane.view.setBounds({
        x: rect.x + PANE_BORDER,
        y: rect.y + PANE_BORDER,
        width: Math.max(0, rect.width - PANE_BORDER * 2),
        height: Math.max(0, rect.height - PANE_BORDER * 2),
      })
      pane.view.setVisible(true)
      placed.add(paneId)
    }
  }
  for (const t of tabs) {
    for (const id of leafIds(t.root)) {
      if (!placed.has(id)) panes.get(id)?.view.setVisible(false)
    }
  }
  if (overlayMode) layoutOverlay()
  layoutPrefs()
  sendStatus()
}

function focusActivePane() {
  const pane = activePane()
  if (pane) {
    const wc = pane.view.webContents
    if (!wc.isFocused()) pendingFocus.set(pane.id, (pendingFocus.get(pane.id) || 0) + 1)
    wc.focus()
  }
  sendStatus()
}

// ---------- directional focus / resize ----------

function focusDirection(dir) {
  const tab = activeTab()
  if (!tab) return
  tab.zoomed = false
  const leaves = currentLeafRects()
  const cur = leaves.find((l) => l.paneId === tab.activePaneId)
  if (!cur) return
  const c = cur.rect
  let best = null
  for (const cand of leaves) {
    if (cand.paneId === cur.paneId) continue
    const r = cand.rect
    let dist = null
    if (dir === 'left' && r.x + r.width <= c.x + 1 && overlaps(r.y, r.height, c.y, c.height)) dist = c.x - (r.x + r.width)
    if (dir === 'right' && r.x >= c.x + c.width - 1 && overlaps(r.y, r.height, c.y, c.height)) dist = r.x - (c.x + c.width)
    if (dir === 'up' && r.y + r.height <= c.y + 1 && overlaps(r.x, r.width, c.x, c.width)) dist = c.y - (r.y + r.height)
    if (dir === 'down' && r.y >= c.y + c.height - 1 && overlaps(r.x, r.width, c.x, c.width)) dist = r.y - (c.y + c.height)
    if (dist !== null && (best === null || dist < best.dist)) best = { paneId: cand.paneId, dist }
  }
  if (best) {
    setActivePane(tab, best.paneId)
    applyLayout()
    focusActivePane()
  }
}

function overlaps(a, alen, b, blen) {
  return a < b + blen && b < a + alen
}

function resizeActive(dir) {
  const tab = activeTab()
  if (!tab) return
  const axis = dir === 'left' || dir === 'right' ? 'row' : 'col'
  const grow = dir === 'right' || dir === 'down'
  let node = findParent(tab.root, tab.activePaneId)?.node
  let parent = node ? findSplitParent(tab.root, node) : null
  while (parent && parent.dir !== axis) {
    node = parent
    parent = findSplitParent(tab.root, node)
  }
  if (!parent) return
  const inFirst = containsNode(parent.a, node)
  const delta = (grow === inFirst ? 1 : -1) * RESIZE_STEP
  parent.ratio = Math.min(0.9, Math.max(0.1, parent.ratio + delta))
  applyLayout()
}

function containsNode(tree, target) {
  if (tree === target) return true
  if (tree.type === 'leaf') return false
  return containsNode(tree.a, target) || containsNode(tree.b, target)
}

// ---------- keyboard ----------

function attachKeyRouter(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (handleKey(input)) event.preventDefault()
  })
}

function effectiveKey(input) {
  const k = input.key
  if (/^[a-zA-Z]$/.test(k)) return input.shift ? k.toUpperCase() : k.toLowerCase()
  return k
}

function keyMatches(binding, input) {
  if (!!binding.control !== !!input.control) return false
  if (!!binding.alt !== !!input.alt) return false
  if (!!binding.meta !== !!input.meta) return false
  if (!!binding.shift !== !!input.shift) return false
  const k = String(binding.key || '').toLowerCase()
  if (!k) return false
  if (/^[a-z]$/.test(k) && input.code === 'Key' + k.toUpperCase()) return true
  if (/^[0-9]$/.test(k) && input.code === 'Digit' + k) return true
  return input.key.toLowerCase() === k
}

function customGlobalBinding(input) {
  return (config.keybindings || []).find(
    (b) => !b.prefix && (b.control || b.alt || b.meta) && b.command && keyMatches(b, input),
  )
}

function urlMatchesGlob(pattern, url) {
  if (!pattern) return true
  const rx = new RegExp('^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  return rx.test(url)
}

function matchingAction(input, isPrefix) {
  const wc = activePane()?.view.webContents
  const url = wc ? wc.getURL() : ''
  return (config.actions || []).find(
    (a) => a && a.key && !!a.key.prefix === !!isPrefix && keyMatches(a.key, input) && urlMatchesGlob(a.match, url),
  )
}

async function runAction(action) {
  const wc = activePane()?.view.webContents
  if (!wc || !action || !action.script) return
  const wrapped = `(async () => {
    const __o = {}
    const bmux = {
      copy: (v) => { __o.copy = String(v) },
      setClipboard: (v) => { __o.copy = String(v) },
      notify: (m) => { __o.notify = String(m) },
      open: (u) => { __o.open = String(u) },
    }
    try { ${action.script}\n } catch (e) { __o.error = String((e && e.message) || e) }
    return __o
  })()`
  let out = {}
  try {
    out = (await wc.executeJavaScript(wrapped, true)) || {}
  } catch (err) {
    out = { error: String((err && err.message) || err) }
  }
  if (typeof out.copy === 'string') clipboard.writeText(out.copy)
  if (out.open) {
    const url = normalizeInput(out.open)
    if (url) wc.loadURL(url)
  }
  if (out.error) setStatusMessage(`${action.name || 'action'}: ${out.error}`)
  else if (out.notify) setStatusMessage(out.notify)
  else setStatusMessage(action.name || 'action ran')
}

function matchesPrefix(input) {
  const p = config.prefix
  return (
    input.key.toLowerCase() === p.key &&
    !!input.control === !!p.control &&
    !!input.alt === !!p.alt &&
    !!input.shift === !!p.shift &&
    !input.meta
  )
}

function setPrefixPending(value) {
  prefixPending = value
  clearTimeout(prefixTimer)
  if (value && config.prefixTimeoutMs > 0) {
    prefixTimer = setTimeout(() => setPrefixPending(false), config.prefixTimeoutMs)
  }
  if (value) scheduleWhichKey()
  else hideWhichKey()
  sendStatus()
}

const REPEATABLE_KEYS = new Set([
  'h', 'j', 'k', 'l', 'H', 'J', 'K', 'L',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
])

function setRepeatPending(value) {
  repeatPending = value
  clearTimeout(repeatTimer)
  if (value) repeatTimer = setTimeout(() => setRepeatPending(false), config.repeatTimeMs || 600)
  sendStatus()
}

// ---------- scroll / copy mode ----------

function enterScrollMode() {
  if (!activePane()) return
  scrollMode = { visual: false, pendingG: false }
  activePane().view.webContents.focus()
  sendStatus()
}

function exitScrollMode() {
  scrollMode = null
  sendStatus()
}

function handleScrollKey(input) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(input.key)) return false
  const wc = activePane()?.view.webContents
  if (!wc) {
    exitScrollMode()
    return true
  }
  const key = effectiveKey(input)
  const js = (code) => wc.executeJavaScript(code, true).catch(() => {})
  const pendingG = scrollMode.pendingG
  scrollMode.pendingG = false

  if (key === 'Escape' || key === 'q') {
    if (scrollMode.visual) {
      scrollMode.visual = false
      js('getSelection().removeAllRanges(); 0')
      sendStatus()
    } else {
      exitScrollMode()
    }
    return true
  }
  if (key === '/') {
    exitScrollMode()
    openFinder('find')
    return true
  }
  if (key === 'y') {
    wc.executeJavaScript('getSelection().toString()', true)
      .then((text) => {
        clipboard.writeText(text || wc.getURL())
        setStatusMessage(text ? `yanked ${text.length} chars` : 'url copied')
      })
      .catch(() => {})
    if (scrollMode.visual) js('getSelection().removeAllRanges(); 0')
    exitScrollMode()
    return true
  }
  if (key === 'v') {
    scrollMode.visual = !scrollMode.visual
    if (scrollMode.visual) {
      js(`(() => {
        const sel = getSelection()
        if (sel.rangeCount === 0 || sel.isCollapsed) {
          const r = document.caretRangeFromPoint(innerWidth / 2, innerHeight / 3)
          if (r) { sel.removeAllRanges(); sel.addRange(r) }
        }
      })(); 0`)
    } else {
      js('getSelection().removeAllRanges(); 0')
    }
    sendStatus()
    return true
  }
  if (scrollMode.visual) {
    const motion = {
      h: ['extend', 'backward', 'character'],
      l: ['extend', 'forward', 'character'],
      j: ['extend', 'forward', 'line'],
      k: ['extend', 'backward', 'line'],
      w: ['extend', 'forward', 'word'],
      b: ['extend', 'backward', 'word'],
      e: ['extend', 'forward', 'word'],
      0: ['extend', 'backward', 'lineboundary'],
      $: ['extend', 'forward', 'lineboundary'],
    }[key]
    if (motion) {
      js(`(() => {
        const sel = getSelection()
        sel.modify('${motion[0]}', '${motion[1]}', '${motion[2]}')
        const el = sel.focusNode && sel.focusNode.parentElement
        if (el && el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(false)
      })(); 0`)
    }
    return true
  }
  if (pendingG && key === 'g') {
    js('scrollTo({ top: 0 }); 0')
    return true
  }
  if (key === 'g') {
    scrollMode.pendingG = true
    return true
  }
  if (key === 'G') {
    js('scrollTo({ top: document.documentElement.scrollHeight }); 0')
    return true
  }
  const scroll = {
    j: 'scrollBy(0, 80)',
    k: 'scrollBy(0, -80)',
    h: 'scrollBy(-80, 0)',
    l: 'scrollBy(80, 0)',
    d: 'scrollBy(0, innerHeight / 2)',
    u: 'scrollBy(0, -innerHeight / 2)',
    f: 'scrollBy(0, innerHeight * 0.9)',
    b: 'scrollBy(0, -innerHeight * 0.9)',
    ' ': 'scrollBy(0, innerHeight * 0.9)',
    ArrowDown: 'scrollBy(0, 80)',
    ArrowUp: 'scrollBy(0, -80)',
  }[key]
  if (scroll) js(scroll + '; 0')
  return true
}

async function startHints(openInNewTab) {
  const wc = activePane()?.view.webContents
  if (!wc) return
  let frames = []
  try { frames = wc.mainFrame.framesInSubtree } catch {}
  if (!frames.length) return
  const counts = await Promise.all(
    frames.map((f) => f.executeJavaScript(hints.countScript(), true).catch(() => 0)),
  )
  const total = counts.reduce((a, b) => a + (b || 0), 0)
  if (!total) return
  const labels = hints.makeLabels(total)
  let offset = 0
  const setups = frames.map((frame, i) => {
    if (!counts[i]) return null
    const slice = labels.slice(offset, offset + counts[i])
    offset += counts[i]
    try {
      return frame.executeJavaScript(hints.setupScript(slice, openInNewTab), true)
        .then((placed) => (placed > 0 ? frame : null))
        .catch(() => null)
    } catch {
      return null
    }
  })
  const active = (await Promise.all(setups)).filter(Boolean)
  if (active.length) {
    hintMode = { openInNewTab, frames: active }
    wc.focus()
    sendStatus()
  }
}

function cancelHintFrames(frames) {
  for (const f of frames) {
    try {
      f.executeJavaScript('window.__bmuxHints && window.__bmuxHints.cancel(); 0', true).catch(() => {})
    } catch {}
  }
}

function stopHints() {
  const frames = hintMode ? hintMode.frames : []
  hintMode = null
  cancelHintFrames(frames)
  sendStatus()
}

function handleHintKey(input) {
  if (input.key === 'Shift') return false
  const ch = effectiveKey(input)
  if (/^[a-z]$/.test(ch) && !input.control && !input.meta && !input.alt) {
    const { openInNewTab, frames } = hintMode
    const call = `window.__bmuxHints ? window.__bmuxHints.key(${JSON.stringify(ch)}) : {status:'miss'}`
    Promise.all(frames.map((f) => {
      try { return f.executeJavaScript(call, true).catch(() => ({ status: 'miss' })) }
      catch { return { status: 'miss' } }
    })).then((results) => {
      const hit = results.find((r) => r && r.status === 'hit')
      const pending = results.some((r) => r && r.status === 'pending')
      if (hit) {
        hintMode = null
        cancelHintFrames(frames)
        sendStatus()
        if (hit.href && openInNewTab) newTab(hit.href)
      } else if (!pending) {
        stopHints()
      }
    }).catch(stopHints)
    return true
  }
  stopHints()
  return input.key === 'Escape'
}

function handleKey(input) {
  if (hintMode) return handleHintKey(input)
  if (prefixPending) {
    setPrefixPending(false)
    if (input.key === 'Control' || input.key === 'Shift' || input.key === 'Alt' || input.key === 'Meta') {
      setPrefixPending(true)
      return false
    }
    runPrefixCommand(input)
    return true
  }
  if (matchesPrefix(input)) {
    if (scrollMode) exitScrollMode()
    if (barMode) setBarMode(false)
    setRepeatPending(false)
    setPrefixPending(true)
    return true
  }
  if (repeatPending) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(input.key)) return false
    if (!input.control && !input.meta && !input.alt && REPEATABLE_KEYS.has(effectiveKey(input))) {
      runPrefixCommand(input)
      return true
    }
    setRepeatPending(false)
  }
  const scrollChord = input.control && ['d', 'u', 'f', 'b'].includes(effectiveKey(input))
  if (scrollMode && !input.meta && !input.alt && (!input.control || scrollChord)) {
    return handleScrollKey(input)
  }
  if (input.control && input.key === 'Tab' && !input.meta && !input.alt) {
    if (tabs.length > 1) selectTab((activeTabIndex + (input.shift ? -1 : 1) + tabs.length) % tabs.length)
    return true
  }
  if (barMode) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(input.key)) return false
    switch (input.key) {
      case '=': case '+': adjustBar(1); return true
      case '-': case '_': adjustBar(-1); return true
      case '0': adjustBar(null); return true
      case 'Escape': case 'Enter': case 'q': setBarMode(false); return true
      default: setBarMode(false)
    }
  }
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(input.key) && (input.control || input.alt || input.meta)) {
    const action = matchingAction(input, false)
    if (action) { runAction(action); return true }
  }
  const mod = process.platform === 'darwin' ? input.meta : input.control
  if (mod && input.alt) {
    if (input.key.toLowerCase() === 'i') { toggleDevTools(activePane()?.view.webContents); return true }
    return false
  }
  if (mod) {
    switch (input.key.toLowerCase()) {
      case 't':
        if (input.shift) reopenClosedTab()
        else runCommand('tab-new')
        return true
      case 'n':
        if (input.shift) runCommand('tab-private')
        else createMainWindow(nextSessionName())
        return true
      case 'o': openFileDialog(); return true
      case 'w':
        if (input.shift) win?.close()
        else closeActivePane()
        return true
      case 'l': openUrlPrompt(false); return true
      case 'p': if (input.shift) { openFinder('commands'); return true } openFinder('tabs'); return true
      case 'g': if (input.shift) { openFinder('grep'); return true } return false
      case 'f': openFinder('find'); return true
      case 'y': openFinder('history'); return true
      case 'r': activePane()?.view.webContents.reload(); return true
      case '[': activePane()?.view.webContents.navigationHistory.goBack(); return true
      case ']': activePane()?.view.webContents.navigationHistory.goForward(); return true
      case '=': case '+': adjustZoomLevel(0.5); return true
      case '-': adjustZoomLevel(-0.5); return true
      case '0': adjustZoomLevel(null); return true
      default:
        if (/^[1-9]$/.test(input.key)) {
          selectTab(input.key === '9' ? tabs.length - 1 : Number(input.key) - 1)
          return true
        }
    }
  }
  const custom = customGlobalBinding(input)
  if (custom) {
    runCommand(custom.command)
    return true
  }
  return false
}

function setBarMode(value) {
  barMode = value
  sendStatus()
}

function toggleDevTools(wc) {
  if (!wc) return
  if (wc.isDevToolsOpened()) wc.closeDevTools()
  else wc.openDevTools({ mode: 'detach' })
}

function adjustBar(step) {
  if (step === null) {
    config.topBarHeight = DEFAULT_BAR_HEIGHT
    config.topBarFontSize = DEFAULT_BAR_FONT
  } else {
    const factor = 1.1 ** step
    config.topBarHeight = Math.min(80, Math.max(24, Math.round(statusBarHeight() * factor)))
    config.topBarFontSize = Math.min(24, Math.max(9, Math.round(statusBarFontSize() * factor * 2) / 2))
  }
  try { fs.writeFileSync(userDataFile('config.json'), JSON.stringify(config, null, 2)) } catch {}
  applyLayout()
  sendStatus()
}

function adjustZoomLevel(delta) {
  const pane = activePane()
  if (!pane) return
  const wc = pane.view.webContents
  const level = delta === null ? 0 : wc.getZoomLevel() + delta
  wc.setZoomLevel(level)
  const key = zoomKey(wc.getURL())
  if (key && !pane.isPrivate) {
    if (level === 0) delete zoomLevels[key]
    else zoomLevels[key] = level
    saveZoomLevelsSoon()
  }
  setStatusMessage(`zoom ${Math.round(Math.pow(1.2, level) * 100)}%`)
}

function runPrefixCommand(input) {
  const key = effectiveKey(input)
  const wc = activePane()?.view.webContents
  switch (key) {
    case '%': splitActive('row'); break
    case '"': splitActive('col'); break
    case 'h': case 'ArrowLeft': focusDirection('left'); break
    case 'j': case 'ArrowDown': focusDirection('down'); break
    case 'k': case 'ArrowUp': focusDirection('up'); break
    case 'l': case 'ArrowRight': focusDirection('right'); break
    case 'H': resizeActive('left'); break
    case 'J': resizeActive('down'); break
    case 'K': resizeActive('up'); break
    case 'L': resizeActive('right'); break
    case 'c': runCommand('tab-new'); break
    case 'x': closeActivePane(); break
    case 'n': selectTab((activeTabIndex + 1) % tabs.length); break
    case 'p': selectTab((activeTabIndex - 1 + tabs.length) % tabs.length); break
    case 'Tab': selectTab(lastTabIndex); break
    case 'z': toggleZoom(); break
    case ';': focusLastPane(); break
    case 'd': win?.close(); break
    case 'q': openDisplayPanes(); break
    case 'v': enterScrollMode(); break
    case 't': setBarMode(true); break
    case '!': breakPaneToTab(); break
    case ',': runCommand('tab-rename'); break
    case '&': closeTab(activeTabIndex); break
    case '{': swapActive(-1); break
    case '}': swapActive(1); break
    case '<': moveTab(-1); break
    case '>': moveTab(1); break
    case '.': runCommand('tab-move-to'); break
    case ' ': equalizeLayout(); break
    case 'e': startHints(false); break
    case 'E': startHints(true); break
    case 'm': openFinder('input', { tag: 'bookmark', label: 'Bookmark tag/name', value: wc?.getTitle() || '' }); break
    case "'": openFinder('bookmarks'); break
    case 'f': openFinder('tabs'); break
    case 's': openFinder('sessions'); break
    case 'w': openFinder('tree'); break
    case '$': openFinder('input', { tag: 'session-rename', label: 'Rename session', value: currentSession }); break
    case 'g': openFinder('grep'); break
    case 'o': openUrlPrompt(false); break
    case 'O': openUrlPrompt(true); break
    case 'u': openFinder('history'); break
    case '/': openFinder('find'); break
    case 'y': runCommand('page-copy-url'); break
    case ':': openFinder('commands'); break
    case 'r': wc?.reload(); break
    case '[': wc?.navigationHistory.goBack(); break
    case ']': wc?.navigationHistory.goForward(); break
    case '?': openFinder('help'); break
    default: {
      if (/^[1-9]$/.test(key)) {
        selectTab(Number(key) - 1)
        break
      }
      const action = matchingAction(input, true)
      if (action) { runAction(action); break }
      const custom = (config.keybindings || []).find((b) => b.prefix && b.command && keyMatches(b, input))
      if (custom) runCommand(custom.command)
    }
  }
  if (REPEATABLE_KEYS.has(key) && !input.control && !input.meta && !input.alt) setRepeatPending(true)
}

// ---------- overlay (telescope-style finders) ----------

function createOverlay() {
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  overlayView.setBackgroundColor('#00000000')
  overlayView.setVisible(false)
  overlayView.webContents.loadFile(path.join(__dirname, 'overlay', 'overlay.html'))
  win.contentView.addChildView(overlayView)

  whichKeyView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  whichKeyView.setBackgroundColor('#00000000')
  whichKeyView.setVisible(false)
  whichKeyView.webContents.loadFile(path.join(__dirname, 'whichkey', 'whichkey.html'))
  win.contentView.addChildView(whichKeyView)
}

function whichKeyHints() {
  const layer = [
    ['%', 'split →'], ['"', 'split ↓'], ['h j k l', 'focus pane'], ['H J K L', 'resize pane'],
    [';', 'last pane'], ['q', 'pane numbers'], ['z', 'zoom pane'], ['x', 'close pane'],
    ['!', 'break out'], ['{ }', 'swap pane'], ['Space', 'equalize'], ['v', 'scroll / copy'],
    ['t', 'top-bar size'], ['e E', 'link hints'], ['c', 'new tab'], ['n p', 'next / prev tab'],
    ['1-9', 'jump tab'], ['Tab', 'last tab'], [', ', 'rename tab'], ['&', 'close tab'],
    ['< >', 'move tab'], ['.', 'move tab to…'], ['d', 'detach window'], ['f', 'find tab/pane'],
    ['s', 'sessions'], ['w', 'windows tree'], ['$', 'rename session'], ['g', 'grep'],
    ['o O', 'open url'], ['u', 'history'], ['m', 'bookmark'], ["'", 'bookmarks'],
    ['/', 'find in page'], ['y', 'copy url'], [':', 'commands'], ['[ ]', 'back / fwd'],
    ['r', 'reload'], ['?', 'help'],
  ].map(([key, desc]) => ({ key, desc }))
  for (const a of config.actions || []) {
    if (a && a.key && a.key.prefix) layer.push({ key: String(a.key.key || '?'), desc: a.name || 'action' })
  }
  for (const b of config.keybindings || []) {
    if (b && b.prefix && b.command) layer.push({ key: String(b.key || '?'), desc: b.command })
  }
  return layer
}

function whichKeyPrefixLabel() {
  const p = config.prefix
  return `${p.control ? 'C-' : ''}${p.alt ? 'M-' : ''}${p.key}`
}

function scheduleWhichKey() {
  clearTimeout(whichKeyTimer)
  if (config.whichKey === false || !whichKeyView) return
  const delay = Number.isFinite(config.whichKeyDelayMs) ? config.whichKeyDelayMs : 250
  whichKeyTimer = setTimeout(showWhichKey, Math.max(0, delay))
}

function showWhichKey() {
  if (!win || !whichKeyView || !prefixPending) return
  win.contentView.addChildView(whichKeyView)
  whichKeyView.setBounds(paneArea())
  whichKeyView.setVisible(true)
  const payload = { hints: whichKeyHints(), prefix: whichKeyPrefixLabel() }
  const wc = whichKeyView.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => { if (prefixPending) wc.send('whichkey', payload) })
  else wc.send('whichkey', payload)
}

function hideWhichKey() {
  clearTimeout(whichKeyTimer)
  whichKeyTimer = null
  if (whichKeyView) whichKeyView.setVisible(false)
}

function layoutOverlay() {
  overlayView.setBounds(paneArea())
}

function overlaySend(channel, data) {
  overlayView.webContents.send(channel, data)
}

async function openFinder(mode, extra = {}) {
  if (overlayMode === 'find' && mode !== 'find') {
    activePane()?.view.webContents.stopFindInPage('clearSelection')
  }
  overlayMode = mode
  const payload = { mode, ...extra }
  if (mode === 'tabs') payload.items = collectTabItems()
  if (mode === 'history') payload.items = [...history].sort((a, b) => b.ts - a.ts).map((h) => ({ ...h, frec: frecency(h) }))
  if (mode === 'open') payload.items = openSuggestions()
  if (mode === 'downloads') payload.items = downloads
  if (mode === 'join') payload.items = joinItems()
  if (mode === 'help') payload.items = keymapHelp()
  if (mode === 'commands') payload.items = commandList()
  if (mode === 'sessions') payload.items = sessionItems()
  if (mode === 'tree') payload.items = treeItems()
  if (mode === 'bookmarks') payload.items = [...marks].sort((a, b) => b.ts - a.ts)
  if (mode === 'import') {
    payload.items = [
      ...bookmarkSources.detectSources(),
      { kind: 'html-prompt', label: 'From an exported bookmarks .html file…' },
    ]
  }
  layoutOverlay()
  overlayView.setVisible(true)
  win.contentView.addChildView(overlayView)
  overlayView.webContents.focus()
  overlaySend('overlay:init', payload)
  sendStatus()
  if (mode === 'grep') {
    const items = await collectGrepItems()
    if (overlayMode === 'grep') overlaySend('overlay:data', { items })
  }
}

function closeFinder() {
  if (overlayMode === 'find') {
    activePane()?.view.webContents.stopFindInPage('keepSelection')
  }
  overlayMode = null
  overlayView.setVisible(false)
  focusActivePane()
}

function openSuggestions() {
  const items = []
  const seen = new Set()
  const byUrl = new Map(history.map((h) => [h.url, h]))
  for (const it of collectTabItems()) {
    if (it.active || seen.has(it.url) || !it.url) continue
    seen.add(it.url)
    items.push({ kind: 'tab', title: it.title, url: it.url, paneId: it.paneId, frec: 0 })
  }
  for (const m of [...marks].sort((a, b) => b.ts - a.ts)) {
    if (seen.has(m.url)) continue
    seen.add(m.url)
    const h = byUrl.get(m.url)
    items.push({ kind: 'mark', title: m.name, url: m.url, frec: h ? frecency(h) : 10 })
  }
  for (const h of [...history].sort((a, b) => b.ts - a.ts)) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    items.push({ kind: '', title: h.title, url: h.url, frec: frecency(h) })
  }
  return items
}

function collectTabItems() {
  const items = []
  tabs.forEach((tab, i) => {
    for (const paneId of leafIds(tab.root)) {
      const wc = panes.get(paneId).view.webContents
      items.push({
        paneId,
        tabIndex: i,
        tabLabel: `${i + 1}:${tabName(tab, i)}`,
        title: wc.getTitle() || '(loading)',
        url: wc.getURL(),
        favicon: tab.isPrivate ? '' : (panes.get(paneId)?.favicon || faviconFor(wc.getURL())),
        active: i === activeTabIndex && paneId === tab.activePaneId,
      })
    }
  })
  return items
}

async function collectGrepItems() {
  const items = []
  for (let i = 0; i < tabs.length; i++) {
    for (const paneId of leafIds(tabs[i].root)) {
      const wc = panes.get(paneId).view.webContents
      let text = ''
      try {
        text = await wc.executeJavaScript('document.body ? document.body.innerText : ""', true)
      } catch {}
      const lines = text
        .split('\n')
        .map((l, n) => ({ n: n + 1, text: l.trim().slice(0, 300) }))
        .filter((l) => l.text.length > 1)
        .slice(0, GREP_MAX_LINES_PER_PANE)
      items.push({
        paneId,
        tabLabel: `${i + 1}:${tabName(tabs[i], i)}`,
        title: wc.getTitle(),
        url: wc.getURL(),
        lines,
      })
    }
  }
  return items
}

function focusPaneById(paneId) {
  const tab = tabOfPane(paneId)
  if (!tab) return
  if (tabs.indexOf(tab) !== activeTabIndex) lastTabIndex = activeTabIndex
  activeTabIndex = tabs.indexOf(tab)
  setActivePane(tab, paneId)
  tab.zoomed = false
  applyLayout()
  focusActivePane()
}

function openFileDialog() {
  const { dialog } = require('electron')
  dialog.showOpenDialog(win, { properties: ['openFile'] }).then((r) => {
    if (!r.canceled && r.filePaths[0]) {
      activePane()?.view.webContents.loadURL(pathToFileURL(r.filePaths[0]).toString())
    }
  })
}

function openUrlPrompt(newTab) {
  const url = activePane()?.view.webContents.getURL() || ''
  openFinder('open', { newTab, value: /^https?:/.test(url) ? url : '' })
}

function normalizeInput(raw) {
  const text = raw.trim()
  if (!text) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || text.startsWith('bmux:')) return text
  if (text.startsWith('/')) return pathToFileURL(text).toString()
  if (text.startsWith('~/')) return pathToFileURL(path.join(app.getPath('home'), text.slice(2))).toString()
  if (text === 'localhost' || text.startsWith('localhost:')) return `http://${text}`
  if (!text.includes(' ') && text.includes('.')) return `https://${text}`
  return config.searchUrl.replace('%s', encodeURIComponent(text))
}

function keymapHelp() {
  const p = `${config.prefix.control ? 'C-' : ''}${config.prefix.key}`
  return [
    { keys: `${p} %`, desc: 'split pane vertically (side by side)' },
    { keys: `${p} "`, desc: 'split pane horizontally (stacked)' },
    { keys: `${p} h/j/k/l`, desc: 'move focus between panes (arrows work too; repeats — keep tapping)' },
    { keys: `${p} H/J/K/L`, desc: 'resize pane (repeats — keep tapping)' },
    { keys: `${p} ;`, desc: 'last active pane' },
    { keys: `${p} q`, desc: 'show pane numbers — press one to jump' },
    { keys: `${p} z`, desc: 'zoom / unzoom pane' },
    { keys: `${p} x`, desc: 'close pane' },
    { keys: `${p} !`, desc: 'break pane out to its own tab' },
    { keys: `${p} { / }`, desc: 'swap pane with previous / next' },
    { keys: `${p} Space`, desc: 'equalize pane sizes' },
    { keys: `${p} v`, desc: 'scroll/copy mode — j/k d/u f/b gg/G scroll · v select (hjkl w/b 0/$) · y yank · / find · q quit' },
    { keys: `${p} t`, desc: 'top-bar resize mode — ⌘+ / ⌘- / ⌘0 scale the bar' },
    { keys: `${p} e / E`, desc: 'link hints — click by keyboard (pane / new tab)' },
    { keys: `${p} c`, desc: 'new tab' },
    { keys: `${p} n / p`, desc: 'next / previous tab' },
    { keys: `${p} 1-9`, desc: 'jump to tab' },
    { keys: `${p} Tab`, desc: 'last tab' },
    { keys: `${p} ,`, desc: 'rename tab' },
    { keys: `${p} &`, desc: 'close tab' },
    { keys: `${p} < / >`, desc: 'move tab left / right' },
    { keys: `${p} .`, desc: 'move tab to position…' },
    { keys: `${p} d`, desc: 'detach — close window, session persists' },
    { keys: `${p} f`, desc: 'find tab/pane (telescope buffers)' },
    { keys: `${p} s`, desc: 'sessions — switch, or type a new name to create (C-x delete)' },
    { keys: `${p} w`, desc: 'choose tree — every tab across every session' },
    { keys: `${p} $`, desc: 'rename session' },
    { keys: `${p} g`, desc: 'live grep across all open pages' },
    { keys: `${p} o / O`, desc: 'open url or search (current pane / new tab)' },
    { keys: `${p} u`, desc: 'history finder' },
    { keys: `${p} m`, desc: 'bookmark current page (tag/name to group)' },
    { keys: `${p} '`, desc: 'bookmarks finder (C-x delete, C-i import from other browsers)' },
    { keys: `${p} /`, desc: 'find in current page' },
    { keys: `${p} y`, desc: 'copy url' },
    { keys: `${p} :`, desc: 'command palette — everything else lives there' },
    { keys: `${p} [ / ]`, desc: 'back / forward' },
    { keys: `${p} r`, desc: 'reload' },
    { keys: `${p} ?`, desc: 'this help' },
    { keys: 'Cmd+T', desc: 'new tab + open prompt' },
    { keys: 'Cmd+N / Shift+N', desc: 'new window (own session) / new private tab' },
    { keys: 'Cmd+Shift+T', desc: 'reopen last closed tab' },
    { keys: 'Ctrl+Tab / Shift', desc: 'next / previous tab' },
    { keys: 'Cmd+1-8 / 9', desc: 'jump to tab / last tab' },
    { keys: 'Cmd+O', desc: 'open local file' },
    { keys: 'Cmd+W / Shift+W', desc: 'close pane / close window' },
    { keys: 'Cmd+L', desc: 'open url / search' },
    { keys: 'Cmd+P', desc: 'find tab/pane' },
    { keys: 'Cmd+Shift+P', desc: 'command palette' },
    { keys: 'Cmd+Shift+G', desc: 'live grep' },
    { keys: 'Cmd+Y', desc: 'history' },
    { keys: 'Cmd+F', desc: 'find in page' },
    { keys: 'Cmd+[ / ]', desc: 'back / forward' },
    { keys: 'Cmd+R', desc: 'reload' },
    { keys: 'Cmd+Alt+I', desc: 'devtools' },
    { keys: 'Cmd+= / - / 0', desc: 'zoom in / out / reset' },
  ]
}

// ---------- command palette ----------

function commandList() {
  return [
    { id: 'session-new', title: 'session: new named session', keys: 'C-b s' },
    { id: 'session-rename', title: 'session: rename current', keys: 'C-b $' },
    { id: 'window-new', title: 'window: new window (own session)', keys: '⌘N' },
    { id: 'window-close', title: 'window: close', keys: '⌘⇧W' },
    { id: 'tab-reopen', title: 'tab: reopen last closed', keys: '⌘⇧T' },
    { id: 'tab-close', title: 'tab: close current tab' },
    { id: 'tab-rename', title: 'tab: rename' },
    { id: 'tab-private', title: 'tab: new private tab (no history, nothing persisted)' },
    { id: 'tab-move-left', title: 'tab: move left', keys: 'C-b <' },
    { id: 'tab-move-right', title: 'tab: move right', keys: 'C-b >' },
    { id: 'tab-move-to', title: 'tab: move to position…', keys: 'C-b .' },
    { id: 'pane-last', title: 'pane: focus last active', keys: 'C-b ;' },
    { id: 'pane-display', title: 'pane: show pane numbers', keys: 'C-b q' },
    { id: 'pane-swap-prev', title: 'pane: swap with previous', keys: 'C-b {' },
    { id: 'pane-swap-next', title: 'pane: swap with next', keys: 'C-b }' },
    { id: 'pane-rotate', title: 'pane: rotate all' },
    { id: 'pane-break', title: 'pane: break out to its own tab', keys: 'C-b !' },
    { id: 'pane-join', title: 'pane: join into another tab…' },
    { id: 'pane-mute', title: 'pane: mute / unmute audio' },
    { id: 'layout-equalize', title: 'layout: equalize panes', keys: 'C-b ␣' },
    { id: 'scroll-mode', title: 'page: scroll / copy mode', keys: 'C-b v' },
    { id: 'topbar-select', title: 'top bar: resize mode (⌘± / ⌘0)', keys: 'C-b t' },
    { id: 'open-clipboard', title: 'page: open clipboard url (paste & go)' },
    { id: 'find-downloads', title: 'find: downloads' },
    { id: 'page-copy-url', title: 'page: copy url', keys: 'C-b y' },
    { id: 'page-hard-reload', title: 'page: hard reload (ignore cache)' },
    { id: 'page-external', title: 'page: open in default browser' },
    { id: 'page-open-file', title: 'page: open local file…', keys: '⌘O' },
    { id: 'page-print', title: 'page: print' },
    { id: 'page-pdf', title: 'page: save as PDF to Downloads' },
    { id: 'page-devtools', title: 'page: toggle devtools', keys: '⌘⌥I' },
    { id: 'bookmarks-import', title: 'bookmarks: import from another browser' },
    { id: 'privacy-toggle-blocking', title: 'privacy: toggle tracker blocking' },
    { id: 'privacy-clear-history', title: 'privacy: clear history' },
    { id: 'privacy-clear-site-data', title: 'privacy: clear cookies, cache & site data' },
    { id: 'appearance-light', title: 'appearance: force light pages' },
    { id: 'appearance-dark', title: 'appearance: force dark pages' },
    { id: 'appearance-system', title: 'appearance: follow system' },
    { id: 'app-preferences', title: 'app: settings…', keys: '⌘,' },
    { id: 'app-downloads', title: 'app: open downloads folder' },
    { id: 'app-config', title: 'app: edit config file' },
    { id: 'app-reload-config', title: 'app: reload config' },
    { id: 'app-check-updates', title: 'app: check for updates' },
    { id: 'app-restart-update', title: 'app: restart to update' },
    { id: 'app-help', title: 'app: all keybindings', keys: 'C-b ?' },
    ...(config.actions || []).map((a, i) => ({ id: `action:${i}`, title: `action: ${a.name || 'unnamed'}` })),
  ]
}

function cyclePane(step) {
  const tab = activeTab()
  if (!tab) return
  const ids = leafIds(tab.root)
  if (ids.length < 2) return
  setActivePane(tab, ids[(ids.indexOf(tab.activePaneId) + step + ids.length) % ids.length])
  tab.zoomed = false
  applyLayout()
  focusActivePane()
}

async function runCommand(id) {
  const wc = activePane()?.view.webContents
  if (id.startsWith('action:')) { runAction((config.actions || [])[Number(id.slice(7))]); return }
  switch (id) {
    case 'tab-next': selectTab((activeTabIndex + 1) % tabs.length); break
    case 'tab-prev': selectTab((activeTabIndex - 1 + tabs.length) % tabs.length); break
    case 'tab-last': selectTab(lastTabIndex); break
    case 'tab-new': newTab(config.homepage); break
    case 'pane-split-right': splitActive('row'); break
    case 'pane-split-down': splitActive('col'); break
    case 'pane-focus-left': focusDirection('left'); break
    case 'pane-focus-right': focusDirection('right'); break
    case 'pane-focus-up': focusDirection('up'); break
    case 'pane-focus-down': focusDirection('down'); break
    case 'pane-focus-next': cyclePane(1); break
    case 'pane-focus-prev': cyclePane(-1); break
    case 'pane-zoom': toggleZoom(); break
    case 'pane-close': closeActivePane(); break
    case 'pane-last': focusLastPane(); break
    case 'pane-join': openFinder('join'); break
    case 'pane-display': openDisplayPanes(); break
    case 'layout-equalize': equalizeLayout(); break
    case 'tab-move-left': moveTab(-1); break
    case 'tab-move-right': moveTab(1); break
    case 'tab-move-to': openFinder('input', { tag: 'tab-move', label: 'Move tab to position', value: String(activeTabIndex + 1) }); break
    case 'scroll-mode': enterScrollMode(); break
    case 'topbar-select': setBarMode(true); break
    case 'find-downloads': openFinder('downloads'); break
    case 'open-clipboard': {
      const url = normalizeInput(clipboard.readText() || '')
      if (url) wc?.loadURL(url)
      else setStatusMessage('clipboard is empty')
      break
    }
    case 'page-back': wc?.navigationHistory.goBack(); break
    case 'page-forward': wc?.navigationHistory.goForward(); break
    case 'page-reload': wc?.reload(); break
    case 'hints': startHints(false); break
    case 'hints-newtab': startHints(true); break
    case 'bookmark-add': openFinder('input', { tag: 'bookmark', label: 'Bookmark tag/name', value: wc?.getTitle() || '' }); break
    case 'open': openUrlPrompt(false); break
    case 'open-newtab': openUrlPrompt(true); break
    case 'find-tabs': openFinder('tabs'); break
    case 'find-grep': openFinder('grep'); break
    case 'find-history': openFinder('history'); break
    case 'find-bookmarks': openFinder('bookmarks'); break
    case 'find-sessions': openFinder('sessions'); break
    case 'find-tree': openFinder('tree'); break
    case 'find-commands': openFinder('commands'); break
    case 'find-in-page': openFinder('find'); break
    case 'session-new': openFinder('input', { tag: 'session-new', label: 'New session name' }); break
    case 'session-rename': openFinder('input', { tag: 'session-rename', label: 'Rename session', value: currentSession }); break
    case 'window-new': createMainWindow(nextSessionName()); break
    case 'window-close': win?.close(); break
    case 'tab-reopen': reopenClosedTab(); break
    case 'page-open-file': openFileDialog(); break
    case 'tab-close': closeTab(activeTabIndex); break
    case 'tab-rename': openFinder('input', { tag: 'rename', label: 'Rename tab', value: tabName(activeTab(), activeTabIndex) }); break
    case 'tab-private': openFinder('open', { newTab: true, private: true, label: 'Private', value: '' }); break
    case 'pane-swap-prev': swapActive(-1); break
    case 'pane-swap-next': swapActive(1); break
    case 'pane-rotate': rotatePanes(); break
    case 'pane-break': breakPaneToTab(); break
    case 'pane-mute':
      if (wc) {
        wc.setAudioMuted(!wc.isAudioMuted())
        setStatusMessage(wc.isAudioMuted() ? 'muted' : 'unmuted')
      }
      break
    case 'page-copy-url':
      if (wc) {
        clipboard.writeText(wc.getURL())
        setStatusMessage('url copied')
      }
      break
    case 'page-hard-reload': wc?.reloadIgnoringCache(); break
    case 'page-external':
      if (wc && /^https?:/.test(wc.getURL())) shell.openExternal(wc.getURL())
      break
    case 'page-print': wc?.print(); break
    case 'page-pdf':
      if (wc) {
        try {
          const data = await wc.printToPDF({})
          const name = (wc.getTitle() || 'page').replace(/[\/:]/g, '-').slice(0, 80)
          const file = path.join(app.getPath('downloads'), `${name}.pdf`)
          fs.writeFileSync(file, data)
          setStatusMessage(`saved ${path.basename(file)}`)
        } catch (err) {
          setStatusMessage(`pdf failed: ${err.message}`)
        }
      }
      break
    case 'page-devtools': toggleDevTools(wc); break
    case 'bookmarks-import': openFinder('import'); break
    case 'privacy-toggle-blocking':
      config.blockTrackers = config.blockTrackers === false
      try { fs.writeFileSync(userDataFile('config.json'), JSON.stringify(config, null, 2)) } catch {}
      applyBlocklist()
      setStatusMessage(`tracker blocking ${config.blockTrackers ? 'on' : 'off'}`)
      break
    case 'privacy-clear-history':
      history = []
      saveHistorySoon()
      setStatusMessage('history cleared')
      break
    case 'privacy-clear-site-data': {
      const ses = session.fromPartition('persist:main')
      await ses.clearStorageData()
      await ses.clearCache()
      setStatusMessage('site data cleared')
      break
    }
    case 'app-preferences': openPreferences(); break
    case 'app-downloads': shell.openPath(app.getPath('downloads')); break
    case 'app-config': shell.openPath(userDataFile('config.json')); break
    case 'app-reload-config':
      loadConfig()
      applyAppearance()
      applyLayout()
      broadcastTheme()
      setStatusMessage('config reloaded')
      break
    case 'appearance-light':
    case 'appearance-dark':
    case 'appearance-system':
      config.appearance = id.replace('appearance-', '')
      try { fs.writeFileSync(userDataFile('config.json'), JSON.stringify(config, null, 2)) } catch {}
      applyAppearance()
      setStatusMessage(`pages follow ${config.appearance} appearance`)
      break
    case 'app-help': openFinder('help'); break
    case 'app-check-updates':
      setStatusMessage('checking for updates…')
      await updater.checkNow()
      setStatusMessage(updater.describe())
      break
    case 'app-restart-update':
      if (!updater.installNow()) setStatusMessage('no update ready to install')
      break
  }
}

// ---------- overlay IPC ----------

ipcMain.on('overlay:close', closeFinder)

ipcMain.on('overlay:action', (_e, msg) => {
  const { mode } = msg
  closeFinder()
  if (mode === 'tabs' && msg.item) focusPaneById(msg.item.paneId)
  if (mode === 'grep' && msg.item) {
    focusPaneById(msg.item.paneId)
    if (msg.query) {
      const wc = panes.get(msg.item.paneId)?.view.webContents
      wc?.findInPage(msg.query, { findNext: false })
      setTimeout(() => wc?.stopFindInPage('keepSelection'), 1500)
    }
  }
  if (mode === 'history' && msg.item) {
    if (msg.newTab) newTab(msg.item.url)
    else activePane()?.view.webContents.loadURL(msg.item.url)
  }
  if (mode === 'open') {
    if (msg.item && msg.item.paneId) {
      focusPaneById(msg.item.paneId)
    } else {
      const url = msg.item ? msg.item.url : normalizeInput(msg.query || '')
      if (!url) return
      if (msg.newTab) newTab(url, !!msg.private)
      else activePane()?.view.webContents.loadURL(url)
    }
  }
  if (mode === 'panes' && msg.item) focusPaneById(msg.item.paneId)
  if (mode === 'join' && msg.item) joinPaneIntoTab(msg.item.tabIndex)
  if (mode === 'downloads' && msg.item) {
    if (msg.newTab) shell.showItemInFolder(msg.item.file || '')
    else if (msg.item.file) shell.openPath(msg.item.file)
    else setStatusMessage('download has no file yet')
  }
  if (mode === 'input' && msg.tag === 'tab-move') {
    const n = parseInt((msg.query || '').trim(), 10)
    if (!isNaN(n)) moveTabTo(Math.max(0, Math.min(tabs.length - 1, n - 1)))
  }
  if (mode === 'input' && msg.tag === 'rename') {
    const tab = activeTab()
    if (tab) tab.customName = (msg.query || '').trim() || null
    sendStatus()
  }
  if (mode === 'input' && msg.tag === 'bookmark') {
    const wc = activePane()?.view.webContents
    if (wc) {
      const { tag, name } = parseMarkInput(msg.query || '', wc.getTitle() || wc.getURL())
      addMark(name, wc.getURL(), tag)
    }
  }
  if (mode === 'input' && msg.tag === 'import-html') {
    const file = (msg.query || '').trim().replace(/^~/, app.getPath('home'))
    if (file) runImport({ kind: 'html', path: file, label: path.basename(file) })
  }
  if (mode === 'bookmarks') {
    if (msg.import) openFinder('import')
    else if (msg.item) {
      if (msg.newTab) newTab(msg.item.url)
      else activePane()?.view.webContents.loadURL(msg.item.url)
    }
  }
  if (mode === 'commands' && msg.item) runCommand(msg.item.id)
  if (mode === 'sessions') {
    if (msg.item) switchSession(msg.item.name)
    else if ((msg.query || '').trim()) switchSession(msg.query)
  }
  if (mode === 'tree' && msg.item) switchSession(msg.item.session, msg.item.tabIndex)
  if (mode === 'input' && msg.tag === 'session-new') switchSession(msg.query)
  if (mode === 'input' && msg.tag === 'session-rename') renameSession(msg.query)
  if (mode === 'import' && msg.item) {
    if (msg.item.kind === 'html-prompt') {
      openFinder('input', { tag: 'import-html', label: 'Path to bookmarks .html', value: '~/' })
    } else {
      runImport(msg.item)
    }
  }
})

ipcMain.on('bookmarks:delete', (_e, { url }) => {
  marks = marks.filter((m) => m.url !== url)
  saveMarks()
})

let dragging = null
let lastDividerGrab = { index: -1, time: 0 }

ipcMain.on('resize:start', (_e, { index }) => {
  const seg = dividerSegments[index]
  if (!seg) return
  const now = Date.now()
  if (lastDividerGrab.index === index && now - lastDividerGrab.time < 400) {
    lastDividerGrab = { index: -1, time: 0 }
    seg.node.ratio = 0.5
    applyLayout()
    saveSessionSoon()
    return
  }
  lastDividerGrab = { index, time: now }
  dragging = seg
  overlayMode = 'resize'
  layoutOverlay()
  overlayView.setVisible(true)
  win.contentView.addChildView(overlayView)
  overlayView.webContents.focus()
  overlaySend('overlay:init', { mode: 'resize', axis: seg.axis })
})

ipcMain.on('resize:move', (_e, { x, y }) => {
  if (!dragging) return
  const r = dragging.rect
  const ratio = dragging.axis === 'row' ? (x - r.x) / r.width : (y + statusBarHeight() - r.y) / r.height
  dragging.node.ratio = Math.min(0.9, Math.max(0.1, ratio))
  applyLayout()
})

ipcMain.on('resize:end', () => {
  if (!dragging) return
  dragging = null
  overlayMode = null
  overlayView.setVisible(false)
  focusActivePane()
  saveSessionSoon()
})

ipcMain.on('resize:reset', (_e, { index }) => {
  const seg = dividerSegments[index]
  if (!seg) return
  seg.node.ratio = 0.5
  applyLayout()
  saveSessionSoon()
})

ipcMain.on('chrome:select-tab', (_e, { index }) => selectTab(index))
ipcMain.on('chrome:close-tab', (_e, { index }) => closeTab(index))
ipcMain.on('chrome:new-tab', () => runCommand('tab-new'))
ipcMain.on('chrome:open-url', () => openUrlPrompt(false))

ipcMain.on('session:delete', (_e, { name }) => {
  if (name === currentSession) return
  delete sessionStore[name]
  saveSession()
})

ipcMain.on('find:query', (_e, { text }) => {
  const wc = activePane()?.view.webContents
  if (!wc) return
  if (text) wc.findInPage(text, { findNext: false })
  else wc.stopFindInPage('clearSelection')
})

ipcMain.on('find:nav', (_e, { text, forward }) => {
  const wc = activePane()?.view.webContents
  if (wc && text) wc.findInPage(text, { findNext: true, forward })
})

// ---------- status bar ----------

function sendStatusSoon() {
  clearTimeout(statusTimer)
  statusTimer = setTimeout(sendStatus, 300)
}

function setStatusMessage(text) {
  statusMsg = text
  clearTimeout(statusMsgTimer)
  statusMsgTimer = setTimeout(() => {
    statusMsg = null
    sendStatus()
  }, 2500)
  sendStatus()
}

function sendStatus() {
  if (!win) return
  const tab = activeTab()
  const wc = activePane()?.view.webContents
  const borders = currentLeafRects().map((l) => ({
    ...l.rect,
    active: l.paneId === tab?.activePaneId,
  }))
  dividerSegments = []
  if (tab && !tab.zoomed) collectDividers(tab.root, paneArea(), dividerSegments)
  win.webContents.send('status', {
    tabs: tabs.map((t, i) => ({
      label: `${i + 1}:${tabName(t, i)}${t.zoomed && i === activeTabIndex ? '·Z' : ''}${t.isPrivate ? '·P' : ''}`,
      active: i === activeTabIndex,
      favicon: t.isPrivate ? '' : (panes.get(t.activePaneId)?.favicon || faviconFor(panes.get(t.activePaneId)?.view.webContents.getURL() || '')),
    })),
    session: currentSession,
    message: statusMsg,
    url: wc ? wc.getURL() : '',
    title: wc ? wc.getTitle() : '',
    loading: wc ? wc.isLoading() : false,
    prefixPending,
    repeatPending,
    scrolling: !!scrollMode,
    visual: !!(scrollMode && scrollMode.visual),
    bar: barMode,
    hinting: !!hintMode,
    blocked: blockedCount,
    borders,
    dividers: dividerSegments.map((s, index) => ({ index, axis: s.axis, x: s.x, y: s.y, length: s.length })),
    statusBarHeight: statusBarHeight(),
    fontSize: statusBarFontSize(),
  })
  if (wc) win.setTitle(wc.getTitle() || 'bmux')
}

// ---------- session persistence ----------

let sessionSaveTimer = null

function serializeNode(node) {
  if (node.type === 'leaf') {
    const wc = panes.get(node.paneId)?.view.webContents
    if (!wc) return { type: 'leaf', url: config.homepage }
    const out = { type: 'leaf', url: wc.getURL() }
    try {
      let entries = wc.navigationHistory.getAllEntries().map((e) => ({ url: e.url, title: e.title }))
      let index = wc.navigationHistory.getActiveIndex()
      if (entries.length > 25) {
        const start = Math.max(0, Math.min(index - 12, entries.length - 25))
        entries = entries.slice(start, start + 25)
        index -= start
      }
      if (entries.length > 1) {
        out.history = entries
        out.historyIndex = index
      }
    } catch {}
    return out
  }
  return { type: 'split', dir: node.dir, ratio: node.ratio, a: serializeNode(node.a), b: serializeNode(node.b) }
}

function serializeTabsOf(tabList, activeIndex) {
  const persisted = tabList.filter((t) => !t.isPrivate)
  return {
    activeTabIndex: Math.min(activeIndex, Math.max(0, persisted.length - 1)),
    tabs: persisted.map((t) => ({ root: serializeNode(t.root), customName: t.customName })),
  }
}

function serializeTabs() {
  return serializeTabsOf(tabs, activeTabIndex)
}

function saveSession() {
  try {
    if (win && !win.isDestroyed()) sessionStore[currentSession] = serializeTabs()
    for (const [w, s] of winContexts) {
      if (w === win || w.isDestroyed() || !s.currentSession || !s.tabs) continue
      try { sessionStore[s.currentSession] = serializeTabsOf(s.tabs, s.activeTabIndex) } catch {}
    }
    fs.writeFileSync(userDataFile('sessions.json'), JSON.stringify({ current: currentSession, sessions: sessionStore }))
  } catch {}
}

function saveSessionSoon() {
  clearTimeout(sessionSaveTimer)
  sessionSaveTimer = setTimeout(saveSession, 1000)
}

function loadSessions() {
  const data = loadJson(userDataFile('sessions.json'), null)
  if (data && data.sessions && Object.keys(data.sessions).length) {
    sessionStore = data.sessions
    currentSession = data.current in data.sessions ? data.current : Object.keys(data.sessions)[0]
    return
  }
  const legacy = loadJson(userDataFile('session.json'), null)
  if (legacy && Array.isArray(legacy.tabs)) sessionStore = { main: legacy }
}

function restoreNode(node, tab) {
  if (node.type === 'leaf') {
    const pane = createPane(node.url, false, { history: node.history, historyIndex: node.historyIndex })
    tab.activePaneId = pane.id
    return leaf(pane.id)
  }
  return {
    type: 'split',
    dir: node.dir,
    ratio: node.ratio,
    a: restoreNode(node.a, tab),
    b: restoreNode(node.b, tab),
  }
}

function restoreTabs(data) {
  if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) {
    newTab(config.homepage)
    return
  }
  for (const t of data.tabs) {
    const tab = { root: null, activePaneId: null, customName: t.customName || null, zoomed: false, isPrivate: false }
    tab.root = restoreNode(t.root, tab)
    tabs.push(tab)
  }
  activeTabIndex = Math.min(data.activeTabIndex || 0, tabs.length - 1)
}

function reopenClosedTab() {
  const entry = closedTabs.pop()
  if (!entry) {
    setStatusMessage('no recently closed tabs')
    return
  }
  const tab = { root: null, activePaneId: null, customName: entry.customName || null, zoomed: false, isPrivate: false }
  tab.root = restoreNode(entry.root, tab)
  tabs.push(tab)
  lastTabIndex = activeTabIndex
  activeTabIndex = tabs.length - 1
  applyLayout()
  focusActivePane()
  saveSessionSoon()
}

function switchSession(name, tabIndex = null) {
  const target = (name || '').trim()
  if (!target) return
  if (target !== currentSession) {
    const other = findWindowForSession(target)
    if (other) {
      if (tabIndex !== null) {
        const s = winContexts.get(other)
        if (s && tabIndex >= 0 && tabIndex < s.tabs.length) s.activeTabIndex = tabIndex
      }
      other.focus()
      return
    }
    saveSession()
    for (const tab of tabs) {
      for (const paneId of leafIds(tab.root)) destroyPane(panes.get(paneId))
    }
    tabs = []
    activeTabIndex = 0
    lastTabIndex = 0
    currentSession = target
    restoreTabs(sessionStore[target])
  }
  if (tabIndex !== null && tabIndex >= 0 && tabIndex < tabs.length) activeTabIndex = tabIndex
  applyLayout()
  focusActivePane()
  saveSession()
}

function renameSession(name) {
  const target = (name || '').trim()
  if (!target || target === currentSession) return
  delete sessionStore[currentSession]
  currentSession = target
  saveSession()
  sendStatus()
}

function firstLeafUrl(node) {
  if (!node) return ''
  if (node.type === 'leaf') return node.url || ''
  return firstLeafUrl(node.a) || firstLeafUrl(node.b)
}

function storedTabLabel(t) {
  if (t.customName) return t.customName
  const url = firstLeafUrl(t.root)
  try {
    return new URL(url).hostname || 'tab'
  } catch {
    return 'tab'
  }
}

function startPageData() {
  const seen = new Set()
  const topSites = []
  for (const h of [...history].sort((a, b) => frecency(b) - frecency(a))) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    topSites.push({ url: h.url, title: h.title || h.url, favicon: faviconFor(h.url) })
    if (topSites.length >= 8) break
  }
  const bookmarks = [...marks].sort((a, b) => b.ts - a.ts).slice(0, 8)
    .map((m) => ({ url: m.url, name: m.name, favicon: faviconFor(m.url) }))
  const recent = []
  for (const c of [...closedTabs].reverse()) {
    const url = firstLeafUrl(c.root)
    if (!url || !/^https?:/.test(url)) continue
    recent.push({ url, title: storedTabLabel(c), favicon: faviconFor(url) })
    if (recent.length >= 6) break
  }
  return { searchUrl: config.searchUrl, topSites, bookmarks, recent }
}

function sessionItems() {
  sessionStore[currentSession] = serializeTabs()
  return Object.keys(sessionStore).map((name) => ({
    name,
    tabCount: (sessionStore[name].tabs || []).length,
    current: name === currentSession,
  }))
}

function treeItems() {
  sessionStore[currentSession] = serializeTabs()
  const items = []
  tabs.forEach((t, i) => {
    items.push({
      session: currentSession,
      tabIndex: i,
      tag: `${currentSession}:${i + 1}`,
      label: tabName(t, i) + (t.isPrivate ? '·P' : ''),
      url: panes.get(t.activePaneId)?.view.webContents.getURL() || '',
      favicon: t.isPrivate ? '' : (panes.get(t.activePaneId)?.favicon || faviconFor(panes.get(t.activePaneId)?.view.webContents.getURL() || '')),
      panes: leafIds(t.root).length,
      current: i === activeTabIndex,
    })
  })
  for (const [name, data] of Object.entries(sessionStore)) {
    if (name === currentSession) continue
    ;(data.tabs || []).forEach((t, i) => {
      items.push({
        session: name,
        tabIndex: i,
        tag: `${name}:${i + 1}`,
        label: storedTabLabel(t),
        url: firstLeafUrl(t.root),
        favicon: faviconFor(firstLeafUrl(t.root)),
        panes: leafCount(t.root),
        current: false,
      })
    })
  }
  return items
}

function leafCount(node) {
  if (!node) return 0
  return node.type === 'leaf' ? 1 : leafCount(node.a) + leafCount(node.b)
}

// ---------- app setup ----------

function applyAppearance() {
  nativeTheme.themeSource = ['light', 'dark', 'system'].includes(config.appearance) ? config.appearance : 'system'
}

function applyBlocklist() {
  const sessions = ['persist:main', 'bmux-private'].map((p) => session.fromPartition(p))
  if (applyEngine(sessions, config, app.getPath('userData'))) return
  const urls = TRACKER_DOMAINS.concat(config.blockExtra || []).flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`])
  for (const ses of sessions) {
    ses.webRequest.onBeforeRequest({ urls }, (_details, callback) => {
      if (config.blockTrackers === false) return callback({})
      blockedCount++
      sendStatusSoon()
      callback({ cancel: true })
    })
  }
}

function hardenSession() {
  for (const partition of ['persist:main', 'bmux-private']) {
    const ses = session.fromPartition(partition)
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'fullscreen' || permission === 'pointerLock' || permission === 'clipboard-sanitized-write')
    })
    ses.on('will-download', (_e, item) => {
      const entry = {
        name: item.getFilename(),
        url: item.getURL(),
        file: '',
        state: 'progressing',
        ts: Date.now(),
        private: partition === 'bmux-private',
      }
      downloads.unshift(entry)
      if (downloads.length > 200) downloads.length = 200
      item.once('done', (_ev, state) => {
        entry.state = state
        entry.file = item.getSavePath()
        if (entry.file) entry.name = path.basename(entry.file)
        saveDownloads()
        setStatusMessage(state === 'completed' ? `downloaded ${entry.name}` : `download ${state}`)
      })
    })
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['DNT'] = '1'
      details.requestHeaders['Sec-GPC'] = '1'
      callback({ requestHeaders: details.requestHeaders })
    })
  }
  applyBlocklist()
  initBlocking(app.getPath('userData'), () => {
    blockedCount++
    sendStatusSoon()
  }).then(() => {
    applyBlocklist()
    adblockReady = true
  }).catch(() => {
    setStatusMessage('filter lists unavailable — using builtin blocklist')
  })
}

const CORE_COMMANDS = [
  { id: 'tab-next', title: 'tab: next' },
  { id: 'tab-prev', title: 'tab: previous' },
  { id: 'tab-last', title: 'tab: last' },
  { id: 'tab-new', title: 'tab: new' },
  { id: 'tab-reopen', title: 'tab: reopen last closed' },
  { id: 'window-new', title: 'window: new' },
  { id: 'pane-split-right', title: 'pane: split right' },
  { id: 'pane-split-down', title: 'pane: split down' },
  { id: 'pane-focus-left', title: 'pane: focus left' },
  { id: 'pane-focus-right', title: 'pane: focus right' },
  { id: 'pane-focus-up', title: 'pane: focus up' },
  { id: 'pane-focus-down', title: 'pane: focus down' },
  { id: 'pane-focus-next', title: 'pane: focus next' },
  { id: 'pane-focus-prev', title: 'pane: focus previous' },
  { id: 'pane-zoom', title: 'pane: zoom / unzoom' },
  { id: 'pane-close', title: 'pane: close' },
  { id: 'pane-last', title: 'pane: focus last active' },
  { id: 'pane-join', title: 'pane: join into another tab' },
  { id: 'pane-display', title: 'pane: show pane numbers' },
  { id: 'layout-equalize', title: 'layout: equalize panes' },
  { id: 'tab-move-left', title: 'tab: move left' },
  { id: 'tab-move-right', title: 'tab: move right' },
  { id: 'scroll-mode', title: 'scroll / copy mode' },
  { id: 'open-clipboard', title: 'open clipboard url' },
  { id: 'find-downloads', title: 'find: downloads' },
  { id: 'page-back', title: 'page: back' },
  { id: 'page-forward', title: 'page: forward' },
  { id: 'page-reload', title: 'page: reload' },
  { id: 'hints', title: 'link hints' },
  { id: 'hints-newtab', title: 'link hints (new tab)' },
  { id: 'bookmark-add', title: 'bookmark current page' },
  { id: 'open', title: 'open / edit url' },
  { id: 'open-newtab', title: 'open url in new tab' },
  { id: 'find-tabs', title: 'find: tabs' },
  { id: 'find-grep', title: 'find: grep pages' },
  { id: 'find-history', title: 'find: history' },
  { id: 'find-bookmarks', title: 'find: bookmarks' },
  { id: 'find-sessions', title: 'find: sessions' },
  { id: 'find-tree', title: 'find: session tree' },
  { id: 'find-commands', title: 'find: commands' },
  { id: 'find-in-page', title: 'find in page' },
]

let prefsView = null

function prefsWebContents() {
  return prefsView ? prefsView.webContents : null
}

function layoutPrefs() {
  if (prefsView) prefsView.setBounds(paneArea())
}

function openPreferences() {
  if (prefsView) {
    closePreferences()
    return
  }
  prefsView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  prefsView.setBackgroundColor('#00000000')
  prefsView.webContents.loadFile(path.join(__dirname, 'prefs', 'prefs.html'))
  win.contentView.addChildView(prefsView)
  layoutPrefs()
  prefsView.webContents.focus()
}

function closePreferences() {
  if (!prefsView) return
  const view = prefsView
  prefsView = null
  try { win?.contentView.removeChildView(view) } catch {}
  try { view.webContents.close() } catch {}
  focusActivePane()
}

ipcMain.on('prefs:close', closePreferences)

ipcMain.handle('prefs:load', () => ({
  config,
  commands: [...CORE_COMMANDS, ...commandList().map((c) => ({ id: c.id, title: c.title }))],
  blocked: blockedCount,
  update: { ...updater.status(), text: updater.describe() },
}))

ipcMain.handle('prefs:check-updates', async () => {
  await updater.checkNow()
  return { ...updater.status(), text: updater.describe() }
})

ipcMain.on('prefs:install-update', () => {
  if (!updater.installNow()) setStatusMessage('no update ready to install')
})

ipcMain.on('prefs:save', (_e, partial) => {
  config = { ...config, ...partial }
  try { fs.writeFileSync(userDataFile('config.json'), JSON.stringify(config, null, 2)) } catch {}
  applyAppearance()
  applyBlocklist()
  applyLayout()
  broadcastTheme()
  sendStatus()
})

ipcMain.handle('theme:get', () => resolveTheme())

const START_ACTION_IDS = new Set([
  'find-tabs', 'find-history', 'find-bookmarks', 'find-grep', 'find-commands',
  'find-tree', 'find-sessions', 'pane-split-right', 'pane-split-down',
  'app-preferences', 'app-help', 'tab-new', 'bookmarks-import',
])

ipcMain.on('start:action', (e, msg) => {
  let url = ''
  try { url = e.senderFrame?.url || '' } catch {}
  if (!url.startsWith('bmux://start')) return
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'open' && typeof msg.url === 'string') {
    const target = normalizeInput(msg.url)
    if (target) activePane()?.view.webContents.loadURL(target)
    return
  }
  if (msg.type === 'run' && START_ACTION_IDS.has(msg.id)) runCommand(msg.id)
})

function broadcastTheme() {
  const theme = resolveTheme()
  win?.webContents.send('theme:update', theme)
  overlayView?.webContents.send('theme:update', theme)
  prefsWebContents()?.send('theme:update', theme)
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'bmux',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openPreferences() },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [{ role: 'togglefullscreen' }],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }],
      },
    ]),
  )
}

const winContexts = new Map()

function snapshotCurrent() {
  if (!win || win.isDestroyed()) return
  if (currentSession && !quitting) {
    try { saveSession() } catch {}
  }
  winContexts.set(win, {
    overlayView, whichKeyView, overlayMode, tabs, activeTabIndex, lastTabIndex,
    hintMode, scrollMode, dividerSegments, dragging, currentSession, statusMsg,
  })
}

function restoreFrom(w) {
  const s = winContexts.get(w)
  if (!s) return
  win = w
  overlayView = s.overlayView
  whichKeyView = s.whichKeyView
  barMode = false
  overlayMode = s.overlayMode
  tabs = s.tabs
  activeTabIndex = s.activeTabIndex
  lastTabIndex = s.lastTabIndex
  hintMode = s.hintMode
  scrollMode = s.scrollMode || null
  dividerSegments = s.dividerSegments
  dragging = s.dragging
  currentSession = s.currentSession
  statusMsg = s.statusMsg
  setPrefixPending(false)
  setRepeatPending(false)
}

function findWindowForSession(name) {
  if (name === currentSession && win && !win.isDestroyed()) return win
  for (const [w, s] of winContexts) {
    if (w !== win && !w.isDestroyed() && s.currentSession === name) return w
  }
  return null
}

function nextSessionName() {
  const attached = new Set([currentSession])
  for (const [, s] of winContexts) attached.add(s.currentSession)
  let n = 2
  while (sessionStore[String(n)] || attached.has(String(n))) n++
  return String(n)
}

function createMainWindow(sessionName) {
  snapshotCurrent()
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 300,
    title: 'bmux',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: Math.round((statusBarHeight() - 14) / 2) },
    backgroundColor: '#16161e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  const w = win
  win.loadFile(path.join(__dirname, 'chrome', 'chrome.html'))
  attachKeyRouter(win.webContents)
  createOverlay()
  tabs = []
  activeTabIndex = 0
  lastTabIndex = 0
  overlayMode = null
  hintMode = null
  scrollMode = null
  dividerSegments = []
  dragging = null
  statusMsg = null
  currentSession = sessionName
  winContexts.set(w, {})
  restoreTabs(sessionStore[sessionName])
  snapshotCurrent()
  w.on('resize', () => { if (win === w) applyLayout() })
  w.webContents.on('did-finish-load', () => { if (win === w) sendStatus() })
  w.on('close', () => {
    if (win === w) {
      closePreferences()
      snapshotCurrent()
    }
    const s = winContexts.get(w)
    if (s) for (const tab of s.tabs) for (const id of leafIds(tab.root)) panes.delete(id)
  })
  w.on('closed', () => {
    winContexts.delete(w)
    if (win === w) {
      win = null
      const remaining = [...winContexts.keys()].find((other) => !other.isDestroyed())
      if (remaining) {
        restoreFrom(remaining)
        remaining.focus()
      }
    }
  })
  applyLayout()
  focusActivePane()
  saveSession()
}

app.on('browser-window-focus', (_e, w) => {
  if (w === win || !winContexts.has(w)) return
  closePreferences()
  snapshotCurrent()
  restoreFrom(w)
  if (tabs.length === 0) newTab(config.homepage)
  applyLayout()
  sendStatus()
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'bmux', privileges: { standard: true, secure: true } },
])

app.setName('bmux')

app.whenReady().then(() => {
  loadConfig()
  applyAppearance()
  loadHistory()
  loadMarks()
  loadDownloads()
  loadZoomLevels()
  hardenSession()
  buildMenu()

  const serveBmux = (req) => {
    const { hostname } = new URL(req.url)
    if (hostname === 'start') {
      let html = fs.readFileSync(path.join(__dirname, 'pages', 'start.html'), 'utf8')
      const vars = Object.entries(resolveTheme()).map(([k, v]) => `--${k}:${v};`).join('')
      const data = JSON.stringify(startPageData()).replace(/</g, '\\u003c')
      html = html.replace('</head>', `<style>:root{${vars}}</style><script>window.__BMUX=${data}</script></head>`)
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    }
    return new Response('not found', { status: 404 })
  }
  protocol.handle('bmux', serveBmux)
  session.fromPartition('persist:main').protocol.handle('bmux', serveBmux)
  session.fromPartition('bmux-private').protocol.handle('bmux', serveBmux)

  loadSessions()
  createMainWindow(currentSession)
  updater.start((message) => setStatusMessage(message))

  if (process.env.BMUX_DEBUG) {
    require('./debug').start({
      getState: () => ({
        activeTabIndex,
        overlayMode,
        prefixPending,
        repeatPending,
        scrolling: !!scrollMode,
        visual: !!(scrollMode && scrollMode.visual),
        hinting: !!hintMode,
        blockedCount,
        currentSession,
        sessions: Object.keys(sessionStore),
        tabs: tabs.map((t, i) => ({
          name: tabName(t, i),
          zoomed: t.zoomed,
          activePaneId: t.activePaneId,
          panes: leafIds(t.root).map((id) => {
            const wc = panes.get(id).view.webContents
            return { id, url: wc.getURL(), title: wc.getTitle(), bounds: panes.get(id).view.getBounds() }
          }),
        })),
      }),
      targetWebContents: (target) => {
        if (target === 'chrome') return win.webContents
        if (target === 'overlay') return overlayView.webContents
        if (target === 'whichkey') return whichKeyView.webContents
        if (target === 'prefs') return prefsWebContents()
        return activePane().view.webContents
      },
      evalMain: (code) => eval(code),
    })
  }
})

app.on('before-quit', () => {
  quitting = true
  clearTimeout(sessionSaveTimer)
  clearTimeout(zoomSaveTimer)
  saveJson('zoom.json', zoomLevels)
  saveSession()
})
app.on('window-all-closed', () => app.quit())
