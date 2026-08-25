import { BrowserWindow, desktopCapturer, globalShortcut, nativeImage, screen } from 'electron'
import type { CaptureSelection, CaptureSource } from '../shared/types'

interface CaptureServiceOptions {
  preloadPath: string
  rendererUrl?: string
  rendererHtml: string
  getMainWindow: () => BrowserWindow | null
}

export class CaptureService {
  private captureWindow: BrowserWindow | null = null
  private source: CaptureSource | null = null
  private registeredShortcut?: string

  constructor(private readonly options: CaptureServiceOptions) {}

  register(shortcut: string, enabled: boolean): boolean {
    if (enabled && this.registeredShortcut === shortcut && globalShortcut.isRegistered(shortcut)) return true
    if (!enabled && !this.registeredShortcut) return true
    if (this.registeredShortcut) {
      globalShortcut.unregister(this.registeredShortcut)
      this.registeredShortcut = undefined
    }
    if (!enabled) return true
    const registered = globalShortcut.register(shortcut, () => void this.open())
    if (registered) this.registeredShortcut = shortcut
    return registered
  }

  async open(): Promise<void> {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.focus()
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const thumbnailSize = {
      width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.size.height * display.scaleFactor))
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error('A képernyő tartalma nem olvasható.')

    const imageSize = source.thumbnail.getSize()
    this.source = {
      dataUrl: source.thumbnail.toDataURL(),
      width: imageSize.width,
      height: imageSize.height,
      displayId: String(display.id)
    }

    this.captureWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.captureWindow.on('closed', () => {
      this.captureWindow = null
      this.source = null
    })
    if (this.options.rendererUrl) {
      await this.captureWindow.loadURL(`${this.options.rendererUrl}#/capture`)
    } else {
      await this.captureWindow.loadFile(this.options.rendererHtml, { hash: '/capture' })
    }
    this.captureWindow.show()
    this.captureWindow.focus()
  }

  getSource(): CaptureSource {
    if (!this.source) throw new Error('Nincs aktív képernyőkivágás.')
    return this.source
  }

  complete(selection: CaptureSelection): void {
    const sourceImage = nativeImage.createFromDataURL(selection.sourceDataUrl)
    const scaleX = selection.sourceWidth / selection.displayWidth
    const scaleY = selection.sourceHeight / selection.displayHeight
    const imageSize = sourceImage.getSize()
    const x = clamp(Math.round(selection.x * scaleX), 0, Math.max(0, imageSize.width - 1))
    const y = clamp(Math.round(selection.y * scaleY), 0, Math.max(0, imageSize.height - 1))
    const width = clamp(Math.round(selection.width * scaleX), 1, imageSize.width - x)
    const height = clamp(Math.round(selection.height * scaleY), 1, imageSize.height - y)
    const cropped = sourceImage.crop({ x, y, width, height })
    const payload = { dataUrl: cropped.toDataURL(), width, height }
    const mainWindow = this.options.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('capture:completed', payload)
      mainWindow.show()
      mainWindow.focus()
    }
    this.close()
  }

  cancel(): void {
    this.close()
  }

  dispose(): void {
    if (this.registeredShortcut) globalShortcut.unregister(this.registeredShortcut)
    this.close()
  }

  private close(): void {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) this.captureWindow.close()
    this.captureWindow = null
    this.source = null
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
