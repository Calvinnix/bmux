const fs = require('fs')
const path = require('path')
const { ipcMain } = require('electron')
const { ElectronBlocker, parseFilters } = require('@ghostery/adblocker-electron')

const GHOSTERY_IPC_CHANNELS = [
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled',
]

const CACHE_FILE = 'adblocker-engine.bin'
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let blocker = null
let appliedExtra = new Set()

async function initBlocking(dir, onBlocked) {
  const engine = process.env.BMUX_ADBLOCK === 'local' ? ElectronBlocker.empty() : await loadPrebuilt(dir)
  engine.on('request-blocked', onBlocked)
  // full lists neutralize many trackers by redirecting to noop resources — count those as blocked
  engine.on('request-redirected', onBlocked)
  blocker = engine
}

async function loadPrebuilt(dir) {
  const cachePath = path.join(dir, CACHE_FILE)
  if (cacheAge(cachePath) > CACHE_MAX_AGE_MS) {
    try {
      return await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cachePath,
        read: () => Promise.reject(new Error('stale')),
        write: fs.promises.writeFile,
      })
    } catch {}
  }
  return ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: cachePath,
    read: fs.promises.readFile,
    write: fs.promises.writeFile,
  })
}

function cacheAge(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs
  } catch {
    return Infinity
  }
}

function applyEngine(sessions, config, dir) {
  if (!blocker) return false
  addExtraFilters(config, dir)
  for (const ses of sessions) {
    const enabled = blocker.isBlockingEnabled(ses)
    if (config.blockTrackers === false) {
      if (enabled) blocker.disableBlockingInSession(ses)
    } else if (!enabled) {
      // enableBlockingInSession registers global ipcMain handlers and throws on the
      // second session; all sessions share one blocker, so re-registering is safe
      GHOSTERY_IPC_CHANNELS.forEach((c) => ipcMain.removeHandler(c))
      blocker.enableBlockingInSession(ses)
    }
  }
  return true
}

function addExtraFilters(config, dir) {
  const lines = (config.blockExtra || []).map((d) => `||${d}^`)
  try {
    lines.push(...fs.readFileSync(path.join(dir, 'filters.txt'), 'utf8').split('\n'))
  } catch {}
  const fresh = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('!') && !appliedExtra.has(l))
  if (!fresh.length) return
  fresh.forEach((l) => appliedExtra.add(l))
  const { networkFilters, cosmeticFilters } = parseFilters(fresh.join('\n'), blocker.config)
  blocker.update({ newNetworkFilters: networkFilters, newCosmeticFilters: cosmeticFilters })
}

module.exports = { initBlocking, applyEngine }
