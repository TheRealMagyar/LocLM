import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { WebContents } from 'electron'
import type {
  Attachment,
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  CodexConnectionStatus,
  ModelDescriptor
} from '../shared/types'

const COMMAND_TIMEOUT_MS = 15_000
const LOGIN_TIMEOUT_MS = 5 * 60_000
const MAX_CAPTURE_CHARS = 2_000_000

interface CodexModelCatalog {
  models?: Array<{
    slug?: string
    display_name?: string
    context_window?: number
    visibility?: string
  }>
}

interface CodexJsonEvent {
  type?: string
  message?: string
  item?: {
    type?: string
    text?: string
  }
}

export class CodexCliService {
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly abortedRequests = new Set<string>()
  private executablePromise?: Promise<string>

  constructor(private readonly workspacePath: () => string) {}

  async status(): Promise<CodexConnectionStatus> {
    let executablePath: string
    try {
      executablePath = await this.executable()
    } catch (error) {
      return {
        installed: false,
        connected: false,
        error: errorText(error)
      }
    }

    try {
      const versionOutput = await this.runCapture(['--version'], COMMAND_TIMEOUT_MS)
      const login = await this.runCaptureResult(['login', 'status'], COMMAND_TIMEOUT_MS)
      const version = /codex(?:-cli)?\s+([^\s]+)/i.exec(versionOutput.stdout)?.[1]
      const loginOutput = `${login.stdout}\n${login.stderr}`
      const authMode = /Logged in using\s+(.+)/i.exec(loginOutput)?.[1]?.trim()
      return {
        installed: true,
        connected: login.code === 0,
        version,
        authMode,
        executablePath,
        error: login.code === 0 ? undefined : cleanProcessError(loginOutput)
      }
    } catch (error) {
      return {
        installed: true,
        connected: false,
        executablePath,
        error: errorText(error)
      }
    }
  }

  async connect(): Promise<CodexConnectionStatus> {
    await this.runCapture(['login'], LOGIN_TIMEOUT_MS)
    return this.status()
  }

  async disconnect(): Promise<CodexConnectionStatus> {
    await this.runCapture(['logout'], COMMAND_TIMEOUT_MS)
    return this.status()
  }

  async listModels(): Promise<ModelDescriptor[]> {
    await this.requireConnected()
    const output = await this.runCapture(['debug', 'models'], COMMAND_TIMEOUT_MS)
    const catalog = JSON.parse(output.stdout) as CodexModelCatalog
    return (catalog.models ?? [])
      .filter((model) => model.visibility === 'list' && Boolean(model.slug))
      .map((model) => ({
        id: model.slug as string,
        name: model.display_name,
        contextLength: model.context_window,
        ownedBy: 'OpenAI'
      }))
  }

  async testConnection(): Promise<{ latencyMs: number; models: ModelDescriptor[] }> {
    const startedAt = performance.now()
    const models = await this.listModels()
    return { latencyMs: Math.round(performance.now() - startedAt), models }
  }

  async startChat(request: ChatRequest, target: WebContents): Promise<void> {
    try {
      const content = await this.runRequest(request)
      this.emit(target, { requestId: request.requestId, type: 'chunk', content })
      this.emit(target, { requestId: request.requestId, type: 'done' })
    } catch (error) {
      if (isAbortError(error)) {
        this.emit(target, { requestId: request.requestId, type: 'done' })
      } else {
        this.emit(target, { requestId: request.requestId, type: 'error', error: errorText(error) })
      }
    }
  }

  async complete(request: ChatRequest): Promise<string> {
    return this.runRequest(request)
  }

  abort(requestId: string): void {
    const child = this.processes.get(requestId)
    if (!child) return
    this.abortedRequests.add(requestId)
    child.kill()
  }

  dispose(): void {
    for (const child of this.processes.values()) child.kill()
    this.processes.clear()
    this.abortedRequests.clear()
  }

  private async runRequest(request: ChatRequest): Promise<string> {
    if (!request.model.modelId) throw new Error('Előbb válassz egy Codex modellt a Beállításokban.')
    await this.requireConnected()
    const workspace = this.workspacePath()
    await mkdir(workspace, { recursive: true })
    const images = imagePaths(request.messages)
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--cd',
      workspace,
      '--model',
      request.model.modelId,
      ...images.flatMap((path) => ['--image', path]),
      '-'
    ]
    const timeoutMs = request.timeoutMs ?? 180_000
    const result = await this.runJsonRequest(request.requestId, args, buildPrompt(request), timeoutMs)
    if (!result.trim()) throw new Error('A Codex CLI üres választ adott.')
    return result.trim()
  }

  private async requireConnected(): Promise<void> {
    const status = await this.status()
    if (!status.installed) throw new Error('A Codex CLI nincs telepítve vagy nem található a PATH-ban.')
    if (!status.connected) throw new Error('A Codex CLI nincs bejelentkezve. A Beállításokban jelentkezz be a ChatGPT-fiókoddal.')
  }

  private async runJsonRequest(requestId: string, args: string[], input: string, timeoutMs: number): Promise<string> {
    const executable = await this.executable()
    this.abortedRequests.delete(requestId)
    const child = spawn(executable, args, {
      cwd: this.workspacePath(),
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.processes.set(requestId, child)

    return new Promise<string>((resolve, reject) => {
      let stdoutBuffer = ''
      let stderr = ''
      const messages: string[] = []
      let settled = false
      const timer = setTimeout(() => {
        child.kill()
        finish(() => reject(new Error('A Codex CLI nem válaszolt időben. Próbáld újra.')))
      }, timeoutMs)
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.processes.delete(requestId)
        callback()
      }
      const parseLines = (flush = false): void => {
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = flush ? '' : lines.pop() ?? ''
        if (flush && lines[lines.length - 1] === '') lines.pop()
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const event = JSON.parse(trimmed) as CodexJsonEvent
            if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
              messages.push(event.item.text)
            } else if (event.type === 'error' && event.message) {
              stderr += `${event.message}\n`
            }
          } catch {
            stderr += `${trimmed}\n`
          }
        }
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        parseLines()
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < MAX_CAPTURE_CHARS) stderr += chunk
      })
      child.on('error', (error) => {
        const aborted = this.abortedRequests.delete(requestId)
        finish(() => reject(aborted ? abortError() : error))
      })
      child.on('close', (code, signal) => {
        parseLines(true)
        if (settled) return
        const aborted = this.abortedRequests.delete(requestId)
        if (aborted) {
          finish(() => reject(abortError()))
          return
        }
        if (signal || code !== 0) {
          finish(() => reject(signal ? abortError() : new Error(cleanProcessError(stderr) || `A Codex CLI hibával állt le (${code ?? 'ismeretlen'}).`)))
          return
        }
        finish(() => resolve(messages.join('\n\n')))
      })
      child.stdin.on('error', () => undefined)
      child.stdin.end(input)
    })
  }

  private async runCapture(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    const result = await this.runCaptureResult(args, timeoutMs)
    if (result.code !== 0) throw new Error(cleanProcessError(result.stderr || result.stdout) || `A Codex CLI hibával állt le (${result.code}).`)
    return { stdout: result.stdout, stderr: result.stderr }
  }

  private async runCaptureResult(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const executable = await this.executable()
    const child = spawn(executable, args, {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        child.kill()
        finish(() => reject(new Error('A Codex CLI művelet túllépte az időkorlátot.')))
      }, timeoutMs)
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { if (stdout.length < MAX_CAPTURE_CHARS) stdout += chunk })
      child.stderr.on('data', (chunk: string) => { if (stderr.length < MAX_CAPTURE_CHARS) stderr += chunk })
      child.on('error', (error) => finish(() => reject(error)))
      child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
    })
  }

  private async executable(): Promise<string> {
    this.executablePromise ??= findCodexExecutable()
    try {
      return await this.executablePromise
    } catch (error) {
      this.executablePromise = undefined
      throw error
    }
  }

  private emit(target: WebContents, event: ChatStreamEvent): void {
    if (!target.isDestroyed()) target.send('ai:chat:event', event)
  }
}

function buildPrompt(request: ChatRequest): string {
  const parts = [
    request.systemPrompt.trim() ? `SYSTEM INSTRUCTIONS:\n${request.systemPrompt.trim()}` : '',
    'Answer as the assistant in the conversation below. Use attached images and the project-file excerpts included in the messages as context. Do not modify files. Return only the assistant response intended for the user.',
    'CONVERSATION:',
    ...request.messages
      .filter((message) => message.status !== 'error' && message.role !== 'system')
      .map((message) => `${message.role.toUpperCase()}:\n${messageText(message)}`)
  ]
  return parts.filter(Boolean).join('\n\n')
}

function messageText(message: ChatMessage): string {
  let text = message.content
  for (const attachment of message.attachments ?? []) {
    if (!attachment.mimeType.startsWith('image/') && attachment.extractedText?.trim()) {
      text += `\n\n--- ${attachment.name} ---\n${attachment.extractedText.trim()}`
    }
  }
  return text || 'Elemezd a csatolt tartalmat.'
}

function imagePaths(messages: ChatMessage[]): string[] {
  const paths = new Set<string>()
  for (const attachment of messages.flatMap((message) => message.attachments ?? [])) {
    if (attachment.mimeType.startsWith('image/') && attachment.path) paths.add(attachment.path)
  }
  return [...paths]
}

async function findCodexExecutable(): Promise<string> {
  const configured = process.env.LOCLM_CODEX_PATH?.trim()
  if (configured && await isExecutable(configured)) return configured

  const fileName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const pathCandidates = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((entry) => join(entry, fileName))
  const commonCandidates = process.platform === 'win32'
    ? await windowsCodexCandidates(fileName)
    : ['/usr/local/bin/codex', '/opt/homebrew/bin/codex']

  for (const candidate of [...pathCandidates, ...commonCandidates]) {
    if (await isExecutable(candidate)) return candidate
  }
  throw new Error('A Codex CLI nem található. Telepítsd, vagy add meg az útvonalát a LOCLM_CODEX_PATH környezeti változóban.')
}

async function windowsCodexCandidates(fileName: string): Promise<string[]> {
  const localAppData = process.env.LOCALAPPDATA?.trim()
  if (!localAppData) return []
  const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin')
  try {
    const entries = await readdir(binRoot, { withFileTypes: true })
    const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const path = join(binRoot, entry.name, fileName)
      const modified = await stat(path).then((value) => value.mtimeMs).catch(() => 0)
      return { path, modified }
    }))
    return candidates.sort((left, right) => right.modified - left.modified).map((entry) => entry.path)
  } catch {
    return []
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function cleanProcessError(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/\bWARN\b|shell snapshot|codex_skills::interface/i.test(line))
    .slice(-6)
    .join('\n')
    .trim()
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortError(): Error {
  const error = new Error('A Codex CLI futása megszakadt.')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
