'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('zt', {
  invoke,
  send: (ch, ...args) => ipcRenderer.send(ch, ...args),
  on(channel, cb) {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  pathForFile(file) {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },
});

contextBridge.exposeInMainWorld('ztEnv', {
  mode: process.argv.includes('--overlay') ? 'overlay' : 'normal',
  uuid: (process.argv.find(a => a.startsWith('--uuid=')) || '').split('=')[1] || ''
});
