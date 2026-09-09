import { readFile } from 'node:fs/promises'
import type { WebContents } from 'electron'
import type { Attachment, ChatMessage, ChatRequest, ChatStreamEvent, ModelDescriptor, ModelProfile } from '../shared/types'

type ApiContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: ApiContent
}

export class AiService {
  private readonly controllers = new Map<string, AbortController>()

  async listModels(profile: ModelProfile, apiKey?: string, extraHeaders?: Record<string, string>): Promise<ModelDescriptor[]> {
    const response = await fetch(`${normalizeBaseUrl(profile.baseUrl)}/models`, {
      headers: requestHeaders(apiKey, extraHeaders)
    })
    if (!response.ok) throw new Error(await responseError(response, 'A modellek lekérése sikertelen.'))
    const payload = await response.json() as {
      data?: Array<{ id: string; owned_by?: string; name?: string; context_window?: number; context_length?: number }>
    }
    return (payload.data ?? [])
      .filter((model) => !/imagine|voice|tts|whisper|embedding/i.test(model.id))
      .map((model) => ({
        id: model.id,
        ownedBy: model.owned_by,
        name: model.name,
        contextLength: model.context_window ?? model.context_length
      }))
  }

  async testConnection(profile: ModelProfile, apiKey?: string, extraHeaders?: Record<string, string>): Promise<{ latencyMs: number; models: ModelDescriptor[] }> {
    const startedAt = performance.now()
    const models = await this.listModels(profile, apiKey, extraHeaders)
    return { latencyMs: Math.round(performance.now() - startedAt), models }
  }

  async startChat(request: ChatRequest, target: WebContents, extraHeaders?: Record<string, string>): Promise<void> {
    if (!request.model.modelId) throw new Error('Előbb válassz egy modellt a Beállításokban.')
    const controller = new AbortController()
    this.controllers.set(request.requestId, controller)

    try {
      const messages = await this.toApiMessages(request.systemPrompt, request.messages)
      const response = await fetch(`${normalizeBaseUrl(request.model.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          ...requestHeaders(request.apiKey, extraHeaders),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model.modelId,
          messages,
          stream: true,
          temperature: 0.7
        }),
        signal: controller.signal
      })

      if (!response.ok) throw new Error(await responseError(response, request.model.source === 'grok' ? 'A Grok modell nem válaszolt.' : 'A helyi modell nem válaszolt.'))
      if (!response.body) throw new Error('A modell üres választ adott.')

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string; reasoning?: string } }> }
        const message = payload.choices?.[0]?.message
        const reasoning = message?.reasoning_content ?? message?.reasoning
        if (reasoning) this.emit(target, { requestId: request.requestId, type: 'reasoning', content: reasoning })
        const parser = new ThinkTagParser()
        for (const part of parser.push(message?.content ?? '')) this.emit(target, { requestId: request.requestId, ...part })
        for (const part of parser.flush()) this.emit(target, { requestId: request.requestId, ...part })
        this.emit(target, { requestId: request.requestId, type: 'done' })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const thinkTagParser = new ThinkTagParser()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string } }> }
            const delta = payload.choices?.[0]?.delta
            const reasoning = delta?.reasoning_content ?? delta?.reasoning
            if (reasoning) this.emit(target, { requestId: request.requestId, type: 'reasoning', content: reasoning })
            if (delta?.content) {
              for (const part of thinkTagParser.push(delta.content)) this.emit(target, { requestId: request.requestId, ...part })
            }
          } catch {
            // Ignore provider-specific keepalive chunks.
          }
        }
      }
      for (const part of thinkTagParser.flush()) this.emit(target, { requestId: request.requestId, ...part })
      this.emit(target, { requestId: request.requestId, type: 'done' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ismeretlen modellhiba.'
      if (controller.signal.aborted) {
        this.emit(target, { requestId: request.requestId, type: 'done' })
      } else {
        this.emit(target, { requestId: request.requestId, type: 'error', error: message })
      }
    } finally {
      this.controllers.delete(request.requestId)
    }
  }

  async complete(request: ChatRequest, extraHeaders?: Record<string, string>): Promise<string> {
    if (!request.model.modelId) throw new Error('Előbb válassz egy modellt a Beállításokban.')
    const local = request.model.source !== 'grok'
    const timeoutMs = request.timeoutMs ?? (local ? 150_000 : 90_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const messages = await this.toApiMessages(request.systemPrompt, request.messages)
      const response = await fetch(`${normalizeBaseUrl(request.model.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          ...requestHeaders(request.apiKey, extraHeaders),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model.modelId,
          messages,
          stream: true,
          temperature: 0.3,
          max_tokens: request.maxTokens ?? (local ? 1400 : 4000)
        }),
        signal: controller.signal
      })
      if (!response.ok) throw new Error(await responseError(response, local ? 'A helyi modell nem válaszolt.' : 'A Grok modell nem válaszolt.'))
      if (!response.body) throw new Error('A modell üres választ adott.')

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        return stripThink(payload.choices?.[0]?.message?.content ?? '')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> }
            content += payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? ''
            if (request.jsonComplete !== false) {
              const ready = firstCompleteJsonObject(content)
              if (ready) {
                controller.abort()
                return stripThink(ready)
              }
            }
          } catch {
            // Ignore keepalive chunks.
          }
        }
      }
      return stripThink(content)
    } catch (error) {
      throw completeError(error, request.model)
    } finally {
      clearTimeout(timer)
    }
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }

  private emit(target: WebContents, event: ChatStreamEvent): void {
    if (!target.isDestroyed()) target.send('ai:chat:event', event)
  }

  private async toApiMessages(systemPrompt: string, messages: ChatMessage[]): Promise<ApiMessage[]> {
    const converted: ApiMessage[] = []
    if (systemPrompt.trim()) converted.push({ role: 'system', content: systemPrompt.trim() })

    for (const message of messages.filter((item) => item.status !== 'error')) {
      if (message.role === 'system') continue
      converted.push({
        role: message.role,
        content: await contentForMessage(message.content, message.attachments)
      })
    }
    return converted
  }
}

class ThinkTagParser {
  private buffer = ''
  private inReasoning = false

  push(chunk: string): Array<Pick<ChatStreamEvent, 'type' | 'content'>> {
    this.buffer += chunk
    const parts: Array<Pick<ChatStreamEvent, 'type' | 'content'>> = []

    while (this.buffer) {
      const tag = this.inReasoning ? '</think>' : '<think>'
      const index = this.buffer.indexOf(tag)
      if (index >= 0) {
        if (index > 0) parts.push({ type: this.inReasoning ? 'reasoning' : 'chunk', content: this.buffer.slice(0, index) })
        this.buffer = this.buffer.slice(index + tag.length)
        this.inReasoning = !this.inReasoning
        continue
      }

      const retainedLength = partialTagSuffixLength(this.buffer, tag)
      const readyLength = this.buffer.length - retainedLength
      if (readyLength > 0) parts.push({ type: this.inReasoning ? 'reasoning' : 'chunk', content: this.buffer.slice(0, readyLength) })
      this.buffer = this.buffer.slice(readyLength)
      break
    }
    return parts
  }

  flush(): Array<Pick<ChatStreamEvent, 'type' | 'content'>> {
    if (!this.buffer) return []
    const part: Pick<ChatStreamEvent, 'type' | 'content'> = { type: this.inReasoning ? 'reasoning' : 'chunk', content: this.buffer }
    this.buffer = ''
    return [part]
  }
}

function partialTagSuffixLength(value: string, tag: string): number {
  const maxLength = Math.min(value.length, tag.length - 1)
  for (let length = maxLength; length > 0; length -= 1) {
    if (tag.startsWith(value.slice(-length))) return length
  }
  return 0
}

async function contentForMessage(text: string, attachments?: Attachment[]): Promise<ApiContent> {
  if (!attachments?.length) return text
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
  let combinedText = text

  for (const attachment of attachments) {
    if (attachment.mimeType.startsWith('image/')) {
      let dataUrl = attachment.previewDataUrl
      if (!dataUrl && attachment.path) {
        const bytes = await readFile(attachment.path)
        dataUrl = `data:${attachment.mimeType};base64,${bytes.toString('base64')}`
      }
      if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl } })
    } else if (attachment.extractedText) {
      combinedText += `\n\n--- ${attachment.name} ---\n${attachment.extractedText}`
    }
  }

  parts.unshift({ type: 'text', text: combinedText || 'Elemezd a csatolt tartalmat.' })
  return parts
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace('://localhost', '://127.0.0.1')
}

function stripThink(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function firstCompleteJsonObject(raw: string): string | undefined {
  const text = stripThink(raw)
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (character === '\\') {
        escape = true
        continue
      }
      if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        const slice = text.slice(start, index + 1)
        try {
          const parsed = JSON.parse(slice) as { items?: unknown; summary?: unknown; score?: unknown }
          if (parsed && typeof parsed === 'object' && ((Array.isArray(parsed.items) && parsed.items.length > 0) || (typeof parsed.summary === 'string' && parsed.summary) || typeof parsed.score === 'number')) {
            return slice
          }
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function completeError(error: unknown, profile: ModelProfile): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(profile.source === 'grok'
      ? 'A Grok nem válaszolt időben. Próbáld újra.'
      : 'A helyi modell túl lassan válaszolt. Csökkentsd a feladatok számát, vagy válassz Grokot vagy Codexet a Tanulás oldalon.')
  }
  const text = errorText(error)
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|UND_ERR|Failed to parse URL|network/i.test(text)) {
    return new Error(profile.source === 'grok'
      ? 'A Grok kapcsolat sikertelen. A Beállításokban ellenőrizd, be vagy-e jelentkezve.'
      : `A helyi modell nem elérhető (${profile.baseUrl || 'nincs végpont'}). Indítsd el az LM Studio-t, vagy válassz Grokot vagy Codexet a Tanulás oldalon.`)
  }
  return error instanceof Error ? error : new Error(text)
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `${error.cause.message} ${(error.cause as NodeJS.ErrnoException).code ?? ''}` : error.cause ? String(error.cause) : ''
  return `${error.message} ${cause}`
}

function requestHeaders(apiKey?: string, extraHeaders?: Record<string, string>): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extraHeaders
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } | string; message?: string }
    if (typeof payload.error === 'string') return payload.error
    return payload.error?.message ?? payload.message ?? `${fallback} (${response.status})`
  } catch {
    return `${fallback} (${response.status})`
  }
}
