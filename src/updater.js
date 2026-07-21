const { app } = require('electron')

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let updater = null
let state = 'disabled'
let detail = process.env.BMUX_DEBUG ? 'debug mode' : 'running from source'
let onStatus = () => {}

function status() {
  return { state, detail, version: app.getVersion() }
}

function describe() {
  switch (state) {
    case 'disabled': return `auto-updates off — ${detail}`
    case 'checking': return 'checking for updates…'
    case 'downloading': return `downloading update ${detail}…`
    case 'ready': return `update ${detail} ready — restart to apply`
    case 'error': return `update check failed: ${detail}`
    default: return `up to date (${app.getVersion()})`
  }
}

function installNow() {
  if (state !== 'ready' || !updater) return false
  updater.quitAndInstall()
  return true
}

function checkNow() {
  if (!updater) return Promise.resolve(status())
  state = 'checking'
  detail = null
  return updater.checkForUpdates().then(status, () => status())
}

function friendlyError(err) {
  const msg = String((err && err.message) || err)
  if (/code signature|not signed|codesign/i.test(msg)) return 'unsigned build cannot auto-update'
  return msg.split('\n')[0].slice(0, 120)
}

function start(notify) {
  if (process.env.BMUX_DEBUG || !app.isPackaged) return
  state = 'idle'
  detail = null
  onStatus = notify || (() => {})
  const { autoUpdater } = require('electron-updater')
  updater = autoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    state = 'downloading'
    detail = info.version
    onStatus(`downloading update ${info.version}…`, state)
  })
  autoUpdater.on('update-not-available', () => {
    state = 'idle'
    detail = null
  })
  autoUpdater.on('update-downloaded', (info) => {
    state = 'ready'
    detail = info.version
    onStatus(`update ${info.version} ready — run “app: restart to update”`, state)
  })
  autoUpdater.on('error', (err) => {
    state = 'error'
    detail = friendlyError(err)
  })

  const check = () => checkNow()
  setTimeout(check, 10000)
  setInterval(check, CHECK_INTERVAL_MS)
}

module.exports = { start, status, describe, installNow, checkNow }
