const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const CHROMIUM_BROWSERS = [
  ['Chrome', 'Google/Chrome'],
  ['Brave', 'BraveSoftware/Brave-Browser'],
  ['Edge', 'Microsoft Edge'],
  ['Chromium', 'Chromium'],
  ['Arc', 'Arc/User Data'],
  ['Vivaldi', 'Vivaldi'],
]

function appSupport(sub) {
  return path.join(os.homedir(), 'Library', 'Application Support', sub)
}

function detectSources() {
  const sources = []
  for (const [label, dir] of CHROMIUM_BROWSERS) {
    const base = appSupport(dir)
    let profiles = []
    try {
      profiles = fs.readdirSync(base).filter((p) => p === 'Default' || p.startsWith('Profile'))
    } catch {
      continue
    }
    for (const profile of profiles) {
      const file = path.join(base, profile, 'Bookmarks')
      if (fs.existsSync(file)) {
        sources.push({ kind: 'chromium', path: file, label: `${label} — ${profile}` })
      }
    }
  }
  const safari = path.join(os.homedir(), 'Library', 'Safari', 'Bookmarks.plist')
  if (fs.existsSync(safari)) sources.push({ kind: 'safari', path: safari, label: 'Safari' })
  const firefoxRoot = path.join(appSupport('Firefox'), 'Profiles')
  try {
    for (const profile of fs.readdirSync(firefoxRoot)) {
      const file = path.join(firefoxRoot, profile, 'places.sqlite')
      if (fs.existsSync(file)) sources.push({ kind: 'firefox', path: file, label: `Firefox — ${profile}` })
    }
  } catch {}
  return sources
}

function importSource(source) {
  if (source.kind === 'chromium') return parseChromium(source.path)
  if (source.kind === 'safari') return parseSafari(source.path)
  if (source.kind === 'firefox') return parseFirefox(source.path)
  if (source.kind === 'html') return parseHtmlExport(source.path)
  throw new Error(`unknown source kind ${source.kind}`)
}

// ---------- Chrome / Brave / Edge / Arc / Vivaldi (JSON) ----------

function parseChromium(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const out = []
  const walk = (node, trail) => {
    if (!node) return
    if (node.type === 'url' && node.url) {
      out.push({ name: node.name || node.url, url: node.url, tag: trail.join('/') })
    } else if (node.children) {
      for (const child of node.children) walk(child, node.name ? [...trail, node.name] : trail)
    }
  }
  for (const root of Object.values(data.roots || {})) {
    if (root && root.children) for (const child of root.children) walk(child, [])
  }
  return out
}

// ---------- Safari (binary plist via plutil) ----------

function parseSafari(file) {
  let json
  try {
    json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString()
  } catch (err) {
    throw new Error('could not read Safari bookmarks — grant Full Disk Access to your terminal and retry')
  }
  const data = JSON.parse(json)
  const out = []
  const walk = (node, trail) => {
    if (!node) return
    if (node.WebBookmarkType === 'WebBookmarkTypeLeaf' && node.URLString) {
      out.push({
        name: (node.URIDictionary && node.URIDictionary.title) || node.URLString,
        url: node.URLString,
        tag: trail.join('/'),
      })
    } else if (Array.isArray(node.Children)) {
      if (node.Title === 'com.apple.ReadingList') return
      const title = node.Title && node.Title !== 'BookmarksBar' && node.Title !== 'BookmarksMenu' ? node.Title : null
      for (const child of node.Children) walk(child, title ? [...trail, title] : trail)
    }
  }
  walk(data, [])
  return out
}

// ---------- Firefox (places.sqlite via sqlite3) ----------

function parseFirefox(file) {
  const tmp = path.join(os.tmpdir(), `bmux-places-${Date.now()}.sqlite`)
  fs.copyFileSync(file, tmp)
  let rows
  try {
    const json = execFileSync(
      '/usr/bin/sqlite3',
      ['-json', tmp, 'SELECT b.id, b.parent, b.type, b.title, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk'],
      { maxBuffer: 64 * 1024 * 1024 },
    ).toString()
    rows = json.trim() ? JSON.parse(json) : []
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ROOT_NAMES = new Set(['', 'root', 'menu', 'toolbar', 'unfiled', 'mobile', 'Bookmarks Menu', 'Bookmarks Toolbar', 'Other Bookmarks', 'Mobile Bookmarks'])
  const trailOf = (id) => {
    const parts = []
    let node = byId.get(id)
    while (node && node.parent && byId.has(node.parent)) {
      node = byId.get(node.parent)
      if (node.title && !ROOT_NAMES.has(node.title)) parts.unshift(node.title)
    }
    return parts
  }
  return rows
    .filter((r) => r.type === 1 && r.url && /^https?:/.test(r.url))
    .map((r) => ({ name: r.title || r.url, url: r.url, tag: trailOf(r.id).join('/') }))
}

// ---------- Netscape HTML export (any browser) ----------

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseHtmlExport(file) {
  const html = fs.readFileSync(file, 'utf8')
  const out = []
  const trail = []
  const tokens = html.matchAll(/<DT><H3[^>]*>([\s\S]*?)<\/H3>|(<\/DL>)|<DT><A[^>]*HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>/gi)
  for (const m of tokens) {
    if (m[1] !== undefined) trail.push(decodeEntities(m[1].trim()))
    else if (m[2]) trail.pop()
    else if (m[3] && /^https?:/.test(m[3])) {
      out.push({ name: decodeEntities(m[4].replace(/<[^>]*>/g, '').trim()) || m[3], url: m[3], tag: trail.join('/') })
    }
  }
  return out
}

module.exports = { detectSources, importSource, parseHtmlExport }
