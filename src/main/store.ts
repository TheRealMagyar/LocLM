import { app } from 'electron'
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Attachment, PersistedState } from '../shared/types'

const now = (): string => new Date().toISOString()

function createDefaultState(): PersistedState {
  const projectId = randomUUID()
  const chatId = randomUUID()
  const timestamp = now()

  return {
    activeProjectId: projectId,
    activeChatId: chatId,
    projects: [
      {
        id: projectId,
        name: 'LocLM',
        createdAt: timestamp,
        updatedAt: timestamp,
        defaultModelId: '',
        systemPrompt: 'Segítőkész, pontos, helyi AI-asszisztens vagy. Jelezd világosan, ha egy művelet külső szolgáltatást használ.',
        enabledPlugins: ['vision', 'documents', 'web'],
        files: []
      }
    ],
    chats: [
      {
        id: chatId,
        projectId,
        title: 'Új beszélgetés',
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
      }
    ],
    settings: {
      language: 'en',
      theme: 'system',
      model: {
        providerName: 'LM Studio',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: '',
        contextLength: 8192,
        supportsVision: true
      },
      capture: {
        enabled: true,
        shortcut: 'CommandOrControl+Shift+S',
        autoAnalyze: true,
        ephemeral: true
      },
      updates: {
        autoCheck: true,
        autoDownload: true,
        installOnQuit: true
      },
      gmail: {
        clientId: ''
      },
      web: {
        provider: 'brave',
        searxngUrl: 'http://127.0.0.1:8080'
      },
      plugins: {
        gmail: false,
        web: true,
        vision: true,
        documents: true
      }
    }
  }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedState>
  return Array.isArray(candidate.projects) && Array.isArray(candidate.chats) && Boolean(candidate.settings)
}

export class StateStore {
  private readonly statePath: string
  private readonly attachmentsPath: string
  private state: PersistedState = createDefaultState()

  constructor() {
    const userData = app.getPath('userData')
    this.statePath = join(userData, 'loclm-state.json')
    this.attachmentsPath = join(userData, 'attachments')
  }

  async initialize(): Promise<void> {
    await mkdir(this.attachmentsPath, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown
      if (isPersistedState(parsed)) {
        this.state = {
          ...parsed,
          projects: parsed.projects.map((project) => ({
            ...project,
            files: Array.isArray(project.files) ? project.files : []
          })),
          settings: {
            ...parsed.settings,
            language: parsed.settings.language === 'hu' ? 'hu' : 'en'
          }
        }
        return
      }
    } catch {
      // First launch or an unreadable state file falls back to a clean workspace.
    }
    await this.persist()
  }

  getState(): PersistedState {
    return structuredClone(this.state)
  }

  async replaceState(nextState: PersistedState): Promise<PersistedState> {
    if (!isPersistedState(nextState)) throw new Error('Érvénytelen LocLM állapot.')
    this.state = structuredClone(nextState)
    await this.persist()
    return this.getState()
  }

  async saveAttachment(sourcePath: string): Promise<Attachment> {
    const id = randomUUID()
    const sourceName = basename(sourcePath)
    const destination = join(this.attachmentsPath, `${id}${extname(sourceName)}`)
    await copyFile(sourcePath, destination)
    const metadata = await stat(destination)
    return {
      id,
      name: sourceName,
      mimeType: mimeFromExtension(sourceName),
      size: metadata.size,
      path: destination
    }
  }

  async saveDataUrl(dataUrl: string, suggestedName = 'kepernyokivagas.png'): Promise<Attachment> {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
    if (!match) throw new Error('Érvénytelen képadat.')
    const id = randomUUID()
    const extension = extensionFromMime(match[1])
    const destination = join(this.attachmentsPath, `${id}${extension}`)
    const bytes = Buffer.from(match[2], 'base64')
    await writeFile(destination, bytes)
    return {
      id,
      name: suggestedName,
      mimeType: match[1],
      size: bytes.length,
      path: destination,
      previewDataUrl: dataUrl
    }
  }

  private async persist(): Promise<void> {
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
  }
}

export function mimeFromExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase()
  const mappings: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv'
  }
  return mappings[extension] ?? 'application/octet-stream'
}

function extensionFromMime(mimeType: string): string {
  const mappings: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp'
  }
  return mappings[mimeType] ?? '.bin'
}
