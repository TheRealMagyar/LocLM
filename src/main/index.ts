import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve, sep } from 'node:path'
import { StateStore } from './store'
import { CredentialVault } from './vault'
import { AiService } from './ai-service'
import { CaptureService } from './capture-service'
import { DocumentService } from './document-service'
import { UpdaterService } from './updater-service'
import { WebSearchService } from './web-service'
import { GrokService } from './grok-service'
import { CodexCliService } from './codex-cli-service'
import { activeModelProfile } from '../shared/model'
import type { AppLanguage, CaptureSelection, ChatRequest, ModelProfile, PersistedState, SecretSettings, WebSettings } from '../shared/types'

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
const grokService = new GrokService()
const codexService = new CodexCliService(() => join(app.getPath('userData'), 'codex-workspace'))

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

  ipcMain.handle('models:list', async (_event, profile: ModelProfile) => {
    try {
      if (profile.source === 'codex') return await codexService.listModels()
      const auth = await resolveModelAuth(profile)
      return await aiService.listModels(auth.profile, auth.apiKey, auth.extraHeaders)
    } catch {
      return []
    }
  })
  ipcMain.handle('models:test', async (_event, profile: ModelProfile) => {
    if (profile.source === 'codex') return codexService.testConnection()
    const auth = await resolveModelAuth(profile)
    return aiService.testConnection(auth.profile, auth.apiKey, auth.extraHeaders)
  })
  ipcMain.on('ai:chat:start', (event, request: ChatRequest) => {
    void (async () => {
      try {
        if (request.model.source === 'codex') {
          await codexService.startChat(request, event.sender)
          return
        }
        const auth = await resolveModelAuth(request.model)
        await aiService.startChat({ ...request, model: auth.profile, apiKey: auth.apiKey }, event.sender, auth.extraHeaders)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ismeretlen modellhiba.'
        if (!event.sender.isDestroyed()) event.sender.send('ai:chat:event', { requestId: request.requestId, type: 'error', error: message })
      }
    })()
  })
  ipcMain.on('ai:chat:abort', (_event, requestId: string) => {
    aiService.abort(requestId)
    codexService.abort(requestId)
  })
  ipcMain.handle('models:complete', async (_event, request: ChatRequest) => {
    try {
      if (request.model.source === 'codex') return await codexService.complete(request)
      const auth = await resolveModelAuth(request.model)
      return await aiService.complete({ ...request, model: auth.profile, apiKey: auth.apiKey }, auth.extraHeaders)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  })

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

  ipcMain.handle('grok:status', () => grokService.status())
  ipcMain.handle('grok:connect', async () => {
    const status = await grokService.connect()
    mainWindow?.show()
    mainWindow?.focus()
    return status
  })
  ipcMain.handle('grok:disconnect', () => grokService.disconnect())

  ipcMain.handle('codex:status', () => codexService.status())
  ipcMain.handle('codex:connect', async () => {
    const status = await codexService.connect()
    mainWindow?.show()
    mainWindow?.focus()
    return status
  })
  ipcMain.handle('codex:disconnect', () => codexService.disconnect())

  ipcMain.handle('web:search', (_event, query: string, settings: WebSettings, language: AppLanguage) => webService.search(query, settings, vault.getSecrets().braveApiKey, language))
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

async function resolveModelAuth(profile: ModelProfile): Promise<{ profile: ModelProfile; apiKey?: string; extraHeaders?: Record<string, string> }> {
  const resolved = profile.source ? profile : activeModelProfile(store.getState().settings)
  if (resolved.source === 'grok') {
    return {
      profile: { ...resolved, providerName: 'Grok', baseUrl: grokService.baseUrl, source: 'grok' },
      apiKey: await grokService.getAccessToken(),
      extraHeaders: grokService.identityHeaders()
    }
  }
  return { profile: { ...resolved, source: 'local' }, apiKey: vault.getSecrets().modelApiKey }
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
  webService.dispose()
  codexService.dispose()
})
