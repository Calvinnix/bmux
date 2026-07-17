const { contextBridge, ipcRenderer } = require('electron')

// Only the built-in bmux:// pages get a bridge, and every call is re-checked
// against the sender frame's URL in the main process — a normal web page never
// receives this object, and could not use it even if it forged one.
try {
  if (location.protocol === 'bmux:') {
    contextBridge.exposeInMainWorld('bmuxStart', {
      run: (id) => ipcRenderer.send('start:action', { type: 'run', id: String(id) }),
      open: (url) => ipcRenderer.send('start:action', { type: 'open', url: String(url) }),
    })
  }
} catch {}
