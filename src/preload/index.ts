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
  gmail: {
    status: () => ipcRenderer.invoke('gmail:status'),
    configuration: () => ipcRenderer.invoke('gmail:configuration'),
    connect: (clientId) => ipcRenderer.invoke('gmail:connect', clientId),
    disconnect: () => ipcRenderer.invoke('gmail:disconnect'),
    search: (query) => ipcRenderer.invoke('gmail:search', query),
    getThreadText: (threadId) => ipcRenderer.invoke('gmail:get-thread-text', threadId),
    createDraft: (input) => ipcRenderer.invoke('gmail:create-draft', input),
    sendDraft: (draftId) => ipcRenderer.invoke('gmail:send-draft', draftId),
    modifyThread: (threadId, addLabelIds, removeLabelIds) => ipcRenderer.invoke('gmail:modify-thread', threadId, addLabelIds, removeLabelIds)
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
