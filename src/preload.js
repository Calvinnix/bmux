const { contextBridge, ipcRenderer } = require('electron')

const RECV = ['status', 'overlay:init', 'overlay:data', 'find:result', 'theme:update', 'whichkey']
const INVOKE = ['prefs:load', 'theme:get', 'prefs:check-updates']
const SEND = ['prefs:save', 'prefs:close', 'prefs:install-update', 'overlay:close', 'overlay:action', 'find:query', 'find:nav', 'bookmarks:delete', 'session:delete', 'resize:start', 'resize:move', 'resize:end', 'resize:reset', 'chrome:select-tab', 'chrome:close-tab', 'chrome:new-tab', 'chrome:open-url']

contextBridge.exposeInMainWorld('bmux', {
  on(channel, cb) {
    if (!RECV.includes(channel)) return
    ipcRenderer.on(channel, (_e, data) => cb(data))
  },
  send(channel, data) {
    if (!SEND.includes(channel)) return
    ipcRenderer.send(channel, data)
  },
  invoke(channel, data) {
    if (!INVOKE.includes(channel)) return Promise.reject(new Error('blocked'))
    return ipcRenderer.invoke(channel, data)
  },
})
