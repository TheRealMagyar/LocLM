import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
import { StateStore } from './store'
import { CredentialVault } from './vault'
import { AiService } from './ai-service'
import { CaptureService } from './capture-service'
import { DocumentService } from './document-service'
import { GmailService } from './gmail-service'
import { UpdaterService } from './updater-service'
import { WebSearchService } from './web-service'
import type { CaptureSelection, ChatRequest, ModelProfile, PersistedState, SecretSettings, WebSettings } from '../shared/types'

if (process.env.LOCLM_USER_DATA_DIR) app.setPath('userData', process.env.LOCLM_USER_DATA_DIR)

let mainWindow: BrowserWindow | null = null
let captureService: CaptureService
let updaterService: UpdaterService
const isDevelopment = !app.isPackaged

const store = new StateStore()
const vault = new CredentialVault()
const aiService = new AiService()
const documentService = new DocumentService()
const webService = new WebSearchService()
const gmailService = new GmailService(vault)

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 620,
    show: false,
    title: 'LocLM',
    backgroundColor: '#111210',
    autoHideMenuBar: true,
    frame: false,
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(process.cwd(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('maximize', () => window.webContents.send('window:maximized-changed', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized-changed', false))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function registerIpc(): void {
  ipcMain.handle('state:load', () => store.getState())
  ipcMain.handle('state:save', async (_event, state: PersistedState) => {
    const saved = await store.replaceState(state)
    captureService.register(saved.settings.capture.shortcut, saved.settings.capture.enabled)
    updaterService.updateSettings(saved.settings.updates)
    return saved
  })
  ipcMain.handle('secrets:get', () => vault.getSecrets())
  ipcMain.handle('secrets:set', (_event, secrets: SecretSettings) => vault.setSecrets(secrets))

  ipcMain.handle('models:list', (_event, profile: ModelProfile) => aiService.listModels(profile, vault.getSecrets().modelApiKey))
  ipcMain.handle('models:test', (_event, profile: ModelProfile) => aiService.testConnection(profile, vault.getSecrets().modelApiKey))
  ipcMain.on('ai:chat:start', (event, request: ChatRequest) => {
    void aiService.startChat({ ...request, apiKey: vault.getSecrets().modelApiKey }, event.sender)
  })
  ipcMain.on('ai:chat:abort', (_event, requestId: string) => aiService.abort(requestId))

  ipcMain.handle('files:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Fájl csatolása',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Támogatott fájlok', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'txt', 'md', 'json', 'csv'] },
        { name: 'Minden fájl', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(async (filePath) => ({
      attachment: await documentService.enrichAttachment(await store.saveAttachment(filePath))
    })))
  })
  ipcMain.handle('files:save-data-url', (_event, dataUrl: string, suggestedName?: string) => store.saveDataUrl(dataUrl, suggestedName))
  ipcMain.handle('documents:export', (_event, title: string, content: string, format: 'docx' | 'pdf' | 'md' | 'txt') => documentService.exportText(title, content, format))
  ipcMain.handle('files:open', async (_event, filePath: string) => {
    const safePath = attachmentPath(filePath)
    const error = await shell.openPath(safePath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('files:reveal', (_event, filePath: string) => shell.showItemInFolder(attachmentPath(filePath)))

  ipcMain.handle('capture:open', () => captureService.open())
  ipcMain.handle('capture:set-shortcut', (_event, shortcut: string, enabled: boolean) => captureService.register(shortcut, enabled))
  ipcMain.handle('capture:get-source', () => captureService.getSource())
  ipcMain.on('capture:complete', (_event, selection: CaptureSelection) => captureService.complete(selection))
  ipcMain.on('capture:cancel', () => captureService.cancel())

  ipcMain.handle('gmail:status', () => gmailService.status())
  ipcMain.handle('gmail:connect', (_event, clientId: string) => gmailService.connect(clientId))
  ipcMain.handle('gmail:disconnect', () => gmailService.disconnect())
  ipcMain.handle('gmail:search', (_event, query: string) => gmailService.search(query))
  ipcMain.handle('gmail:get-thread-text', (_event, threadId: string) => gmailService.getThreadText(threadId))
  ipcMain.handle('gmail:create-draft', (_event, input) => gmailService.createDraft(input))
  ipcMain.handle('gmail:send-draft', (_event, draftId: string) => gmailService.sendDraft(draftId))
  ipcMain.handle('gmail:modify-thread', (_event, threadId: string, addLabelIds: string[], removeLabelIds: string[]) => gmailService.modifyThread(threadId, addLabelIds, removeLabelIds))

  ipcMain.handle('web:search', (_event, query: string, settings: WebSettings) => webService.search(query, settings, vault.getSecrets().braveApiKey))
  ipcMain.handle('web:open-external', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Csak HTTP(S) link nyitható meg.')
    await shell.openExternal(url)
  })

  ipcMain.handle('updater:check', () => updaterService.check())
  ipcMain.on('updater:install', () => updaterService.install())
  ipcMain.handle('app:get-info', () => ({ version: app.getVersion(), platform: process.platform }))
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
}

function attachmentPath(filePath: string): string {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Érvénytelen fájlútvonal.')
  const attachmentsRoot = resolve(app.getPath('userData'), 'attachments')
  const candidate = resolve(filePath)
  if (candidate !== attachmentsRoot && !candidate.startsWith(`${attachmentsRoot}${sep}`)) {
    throw new Error('A fájl nem a LocLM projektkönyvtárában található.')
  }
  return candidate
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.loclm.desktop')

  await store.initialize()
  await vault.initialize()
  mainWindow = createWindow()

  captureService = new CaptureService({
    preloadPath: join(__dirname, '../preload/index.cjs'),
    rendererUrl: isDevelopment ? process.env.ELECTRON_RENDERER_URL : undefined,
    rendererHtml: join(__dirname, '../renderer/index.html'),
    getMainWindow: () => mainWindow
  })
  updaterService = new UpdaterService(() => mainWindow)
  registerIpc()

  const state = store.getState()
  const shortcutRegistered = captureService.register(state.settings.capture.shortcut, state.settings.capture.enabled)
  if (!shortcutRegistered && state.settings.capture.enabled) {
    void dialog.showMessageBox({ type: 'warning', title: 'LocLM gyorsbillentyű', message: 'A képernyőkivágás gyorsbillentyűjét egy másik alkalmazás használja. A Beállításokban válassz másikat.' })
  }
  updaterService.initialize(state.settings.updates)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  captureService?.dispose()
  updaterService?.dispose()
})
