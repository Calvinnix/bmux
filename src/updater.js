const { app } = require('electron')

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let updater = null
let state = 'idle'
let onStatus = () => {}

function status() {
  return state
}

function installNow() {
  if (state !== 'ready' || !updater) return false
  updater.quitAndInstall()
  return true
}

function start(notify) {
  if (process.env.BMUX_DEBUG || !app.isPackaged) return
  onStatus = notify || (() => {})
  const { autoUpdater } = require('electron-updater')
  updater = autoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    state = 'downloading'
    onStatus(`downloading update ${info.version}…`, state)
  })
  autoUpdater.on('update-not-available', () => { state = 'idle' })
  autoUpdater.on('update-downloaded', (info) => {
    state = 'ready'
    onStatus(`update ${info.version} ready — run “app: restart to update”`, state)
  })
  autoUpdater.on('error', () => { state = 'idle' })

  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 10000)
  setInterval(check, CHECK_INTERVAL_MS)
}

module.exports = { start, status, installNow }
