import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateSettings, UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

export class UpdaterService {
  private initialized = false
  private interval?: NodeJS.Timeout

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  initialize(settings: UpdateSettings): void {
    if (this.initialized) return
    this.initialized = true
    autoUpdater.autoDownload = settings.autoDownload
    autoUpdater.autoInstallOnAppQuit = settings.installOnQuit

    autoUpdater.on('checking-for-update', () => this.emit({ status: 'checking', message: 'Frissítések keresése…' }))
    autoUpdater.on('update-available', (info) => this.emit({ status: 'available', version: info.version, message: `A(z) ${info.version} verzió elérhető.` }))
    autoUpdater.on('update-not-available', (info) => this.emit({ status: 'idle', version: info.version, message: 'A legfrissebb verzió van telepítve.' }))
    autoUpdater.on('download-progress', (progress) => this.emit({ status: 'downloading', percent: progress.percent, message: 'Frissítés letöltése…' }))
    autoUpdater.on('update-downloaded', (info) => this.emit({ status: 'downloaded', version: info.version, message: 'A frissítés telepítésre kész.' }))
    autoUpdater.on('error', (error) => this.emit({ status: 'error', message: error.message }))

    if (app.isPackaged && settings.autoCheck && this.hasUpdateFeed()) {
      setTimeout(() => void this.check(), 12_000)
      this.interval = setInterval(() => void this.check(), 6 * 60 * 60 * 1000)
    }
  }

  updateSettings(settings: UpdateSettings): void {
    autoUpdater.autoDownload = settings.autoDownload
    autoUpdater.autoInstallOnAppQuit = settings.installOnQuit
    if (!settings.autoCheck && this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) {
      const state: UpdateState = { status: 'idle', version: app.getVersion(), message: 'Fejlesztői módban a frissítésellenőrzés ki van kapcsolva.' }
      this.emit(state)
      return state
    }
    if (!this.hasUpdateFeed()) {
      const state: UpdateState = { status: 'idle', version: app.getVersion(), message: 'Ehhez a helyi buildhez még nincs GitHub Releases frissítési csatorna.' }
      this.emit(state)
      return state
    }
    await autoUpdater.checkForUpdates()
    return { status: 'checking' }
  }

  install(): void {
    if (app.isPackaged) autoUpdater.quitAndInstall(false, true)
  }

  dispose(): void {
    if (this.interval) clearInterval(this.interval)
  }

  private emit(state: UpdateState): void {
    const window = this.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('updater:state', state)
  }

  private hasUpdateFeed(): boolean {
    return existsSync(join(process.resourcesPath, 'app-update.yml'))
  }
}
