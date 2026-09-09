import { contextBridge, ipcRenderer } from 'electron'
import type { LoclmApi } from '../shared/api'

const api: LoclmApi = {
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (state) => ipcRenderer.invoke('state:save', state)
  },
  secrets: {
    get: () => ipcRenderer.invoke('secrets:get'),
    set: (secrets) => ipcRenderer.invoke('secrets:set', secrets)
  },
  models: {
    list: (profile) => ipcRenderer.invoke('models:list', profile),
    test: (profile) => ipcRenderer.invoke('models:test', profile),
    startChat: (request) => ipcRenderer.send('ai:chat:start', request),
    abortChat: (requestId) => ipcRenderer.send('ai:chat:abort', requestId),
    complete: (request) => ipcRenderer.invoke('models:complete', request),
    onEvent: (callback) => subscribe('ai:chat:event', callback)
  },
  files: {
    pick: () => ipcRenderer.invoke('files:pick'),
    saveDataUrl: (dataUrl, suggestedName) => ipcRenderer.invoke('files:save-data-url', dataUrl, suggestedName),
    exportText: (title, content, format) => ipcRenderer.invoke('documents:export', title, content, format),
    open: (path) => ipcRenderer.invoke('files:open', path),
    reveal: (path) => ipcRenderer.invoke('files:reveal', path)
  },
  capture: {
    open: () => ipcRenderer.invoke('capture:open'),
    setShortcut: (shortcut, enabled) => ipcRenderer.invoke('capture:set-shortcut', shortcut, enabled),
    getSource: () => ipcRenderer.invoke('capture:get-source'),
    complete: (selection) => ipcRenderer.send('capture:complete', selection),
    cancel: () => ipcRenderer.send('capture:cancel'),
    onCompleted: (callback) => subscribe('capture:completed', callback)
  },
  grok: {
    status: () => ipcRenderer.invoke('grok:status'),
    connect: () => ipcRenderer.invoke('grok:connect'),
    disconnect: () => ipcRenderer.invoke('grok:disconnect')
  },
  codex: {
    status: () => ipcRenderer.invoke('codex:status'),
    connect: () => ipcRenderer.invoke('codex:connect'),
    disconnect: () => ipcRenderer.invoke('codex:disconnect')
  },
  web: {
    search: (query, settings, language) => ipcRenderer.invoke('web:search', query, settings, language),
    openExternal: (url) => ipcRenderer.invoke('web:open-external', url)
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.send('updater:install'),
    onState: (callback) => subscribe('updater:state', callback)
  },
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info')
  },
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => subscribe('window:maximized-changed', callback)
  }
}

contextBridge.exposeInMainWorld('loclm', api)

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
