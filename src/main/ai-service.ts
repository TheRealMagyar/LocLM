import { readFile } from 'node:fs/promises'
import { nativeImage, type WebContents } from 'electron'
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
    const timeoutMs = request.timeoutMs ?? (request.model.source === 'grok' ? 90_000 : 150_000)
    let timedOut = false
    let received = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const emit = (event: ChatStreamEvent): void => {
      if (event.type === 'chunk' || event.type === 'reasoning') received = true
      this.emit(target, event)
    }

    try {
      const messages = await this.toApiMessages(request.systemPrompt, request.messages)
      const response = await postChatCompletion(request, {
        messages,
        stream: true,
        temperature: 0.7
      }, extraHeaders, controller.signal)
      if (!response.body) throw new Error('A modell üres választ adott.')

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string; reasoning?: string } }> }
        const message = payload.choices?.[0]?.message
        const reasoning = message?.reasoning_content ?? message?.reasoning
        if (reasoning) emit({ requestId: request.requestId, type: 'reasoning', content: reasoning })
        const parser = new ThinkTagParser()
        for (const part of parser.push(message?.content ?? '')) emit({ requestId: request.requestId, ...part })
        for (const part of parser.flush()) emit({ requestId: request.requestId, ...part })
        emit({ requestId: request.requestId, type: 'done' })
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
            if (reasoning) emit({ requestId: request.requestId, type: 'reasoning', content: reasoning })
            if (delta?.content) {
              for (const part of thinkTagParser.push(delta.content)) emit({ requestId: request.requestId, ...part })
            }
          } catch {
            // Ignore provider-specific keepalive chunks.
          }
        }
      }
      for (const part of thinkTagParser.flush()) emit({ requestId: request.requestId, ...part })
      emit({ requestId: request.requestId, type: 'done' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ismeretlen modellhiba.'
      if (controller.signal.aborted && (!timedOut || received)) {
        this.emit(target, { requestId: request.requestId, type: 'done' })
      } else if (timedOut) {
        this.emit(target, { requestId: request.requestId, type: 'error', error: timeoutMessage(request.model) })
      } else {
        this.emit(target, { requestId: request.requestId, type: 'error', error: message })
      }
    } finally {
      clearTimeout(timer)
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
      const response = await postChatCompletion(request, {
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: request.maxTokens ?? (local ? 1400 : 4000)
      }, extraHeaders, controller.signal)
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
      if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl.length > 140_000 ? shrinkDataUrl(dataUrl, 1024, 62) : dataUrl } })
    } else if (attachment.extractedText) {
      combinedText += `\n\n--- ${attachment.name} ---\n${attachment.extractedText}`
    }
  }

  parts.unshift({ type: 'text', text: combinedText || 'Elemezd a csatolt tartalmat.' })
  return parts
}

async function postChatCompletion(
  request: ChatRequest,
  fields: Record<string, unknown>,
  extraHeaders: Record<string, string> | undefined,
  signal: AbortSignal
): Promise<Response> {
  const fallback = request.model.source === 'grok' ? 'A Grok modell nem válaszolt.' : 'A helyi modell nem válaszolt.'
  const url = `${normalizeBaseUrl(request.model.baseUrl)}/chat/completions`
  const send = (body: Record<string, unknown>): Promise<Response> => fetch(url, {
    method: 'POST',
    headers: {
      ...requestHeaders(request.apiKey, extraHeaders),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })

  const markNewChat = !/\/v1$/i.test(normalizeBaseUrl(request.model.baseUrl))
  const originalMessages = (fields.messages as ApiMessage[] | undefined) ?? []
  const limits = requestBodyLimits(request.model)
  let withParent = markNewChat
  let limitIndex = 0
  let messages = fitApiMessages(originalMessages, requestBodyEnvelope(request, fields, withParent), limits[0])
  let response = await send(requestBody(request, fields, messages, withParent))

  while (!response.ok && limitIndex < limits.length) {
    const message = await responseError(response, fallback)
    const needsParent = response.status === 400 && !withParent && /startswith|NoneType|parent_id|chat_id/i.test(message)
    if (needsParent) {
      withParent = true
      messages = fitApiMessages(originalMessages, requestBodyEnvelope(request, fields, withParent), limits[limitIndex])
      response = await send(requestBody(request, fields, messages, withParent))
      continue
    }
    if (isPayloadTooLarge(message, response.status) && limitIndex < limits.length - 1) {
      limitIndex += 1
      messages = fitApiMessages(originalMessages, requestBodyEnvelope(request, fields, withParent), limits[limitIndex])
      response = await send(requestBody(request, fields, messages, withParent))
      continue
    }
    throw new Error(sanitizeProviderMessage(message, response.status))
  }
  return response
}

function requestBody(
  request: ChatRequest,
  fields: Record<string, unknown>,
  messages: ApiMessage[],
  withParent: boolean
): Record<string, unknown> {
  return {
    model: request.model.modelId,
    ...fields,
    messages,
    ...(withParent ? { parent_id: null } : {})
  }
}

function requestBodyEnvelope(request: ChatRequest, fields: Record<string, unknown>, withParent: boolean): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...fields }
  delete rest.messages
  return {
    model: request.model.modelId,
    ...rest,
    ...(withParent ? { parent_id: null } : {})
  }
}

function requestBodyLimits(profile: ModelProfile): number[] {
  const remote = profile.source !== 'grok' && profile.source !== 'codex' && !/^https?:\/\/(127\.0\.0\.1|localhost)([/:?]|$)/i.test(profile.baseUrl)
  return remote ? [256_000, 128_000, 64_000] : [8_000_000, 2_000_000]
}

const IMAGE_TIERS = [
  { edge: 1024, quality: 62 },
  { edge: 768, quality: 50 },
  { edge: 512, quality: 38 },
  { edge: 384, quality: 30 }
]

function fitApiMessages(messages: ApiMessage[], envelope: Record<string, unknown>, limitBytes: number): ApiMessage[] {
  const slots = listImageSlots(messages)
  let fitted = messages
  if (slots.some((slot) => imageUrl(messages, slot).length > 180_000)) {
    fitted = applyImageTier(messages, IMAGE_TIERS[0].edge, IMAGE_TIERS[0].quality)
  }
  for (const tier of IMAGE_TIERS) {
    if (payloadBytes(envelope, fitted) <= limitBytes) return fitted
    fitted = applyImageTier(messages, tier.edge, tier.quality)
  }

  let omitted = 0
  while (payloadBytes(envelope, fitted) > limitBytes) {
    const remaining = listImageSlots(fitted)
    if (!remaining.length) break
    fitted = removeImageSlot(fitted, remaining[0])
    omitted += 1
  }
  if (omitted) fitted = noteOmittedImages(fitted, omitted)
  let truncated = truncateTexts(fitted, envelope, limitBytes)
  if (payloadBytes(envelope, truncated) <= limitBytes) return truncated
  const system = truncated.find((message) => message.role === 'system')
  const lastUser = [...truncated].reverse().find((message) => message.role === 'user')
  truncated = truncateTexts([
    ...(system ? [system] : []),
    ...(lastUser ? [lastUser] : truncated.slice(-1))
  ], envelope, limitBytes)
  return truncated
}

function applyImageTier(messages: ApiMessage[], maxEdge: number, quality: number): ApiMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part) => part.type === 'image_url'
        ? { ...part, image_url: { url: shrinkDataUrl(part.image_url.url, maxEdge, quality) } }
        : part)
    }
  })
}

function shrinkDataUrl(dataUrl: string, maxEdge: number, quality: number): string {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return dataUrl
  const { width, height } = image.getSize()
  if (!width || !height) return dataUrl
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const resized = scale < 1
    ? image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good'
    })
    : image
  const next = `data:image/jpeg;base64,${resized.toJPEG(quality).toString('base64')}`
  return next.length < dataUrl.length ? next : dataUrl
}

function listImageSlots(messages: ApiMessage[]): Array<{ messageIndex: number; partIndex: number }> {
  const slots: Array<{ messageIndex: number; partIndex: number }> = []
  messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.content)) return
    message.content.forEach((part, partIndex) => {
      if (part.type === 'image_url') slots.push({ messageIndex, partIndex })
    })
  })
  return slots
}

function imageUrl(messages: ApiMessage[], slot: { messageIndex: number; partIndex: number }): string {
  const content = messages[slot.messageIndex]?.content
  if (!Array.isArray(content)) return ''
  const part = content[slot.partIndex]
  return part?.type === 'image_url' ? part.image_url.url : ''
}

function removeImageSlot(messages: ApiMessage[], slot: { messageIndex: number; partIndex: number }): ApiMessage[] {
  return messages.map((message, messageIndex) => {
    if (messageIndex !== slot.messageIndex || !Array.isArray(message.content)) return message
    return { ...message, content: message.content.filter((_, partIndex) => partIndex !== slot.partIndex) }
  })
}

function noteOmittedImages(messages: ApiMessage[], count: number): ApiMessage[] {
  const note = `\n\n[${count} image${count === 1 ? '' : 's'} omitted because the model server rejected the request size.]`
  let index = -1
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === 'user') {
      index = cursor
      break
    }
  }
  if (index < 0) return messages
  return messages.map((message, messageIndex) => messageIndex === index ? appendText(message, note) : message)
}

function appendText(message: ApiMessage, note: string): ApiMessage {
  if (typeof message.content === 'string') return { ...message, content: `${message.content}${note}` }
  let textIndex = -1
  for (let cursor = message.content.length - 1; cursor >= 0; cursor -= 1) {
    if (message.content[cursor]?.type === 'text') {
      textIndex = cursor
      break
    }
  }
  if (textIndex < 0) return { ...message, content: [...message.content, { type: 'text', text: note.trim() }] }
  return {
    ...message,
    content: message.content.map((part, index) => index === textIndex && part.type === 'text'
      ? { ...part, text: `${part.text}${note}` }
      : part)
  }
}

function truncateTexts(messages: ApiMessage[], envelope: Record<string, unknown>, limitBytes: number): ApiMessage[] {
  let next = messages
  for (let attempt = 0; attempt < 24 && payloadBytes(envelope, next) > limitBytes; attempt += 1) {
    const target = longestText(next)
    if (!target || target.length <= 240) break
    const keep = Math.max(240, Math.floor(target.length * 0.6))
    next = replaceText(next, target, `${target.slice(0, keep)}\n\n[Text truncated to fit the model server limit.]`)
  }
  return next
}

function longestText(messages: ApiMessage[]): string | undefined {
  let longest = ''
  for (const message of messages) {
    if (typeof message.content === 'string' && message.content.length > longest.length) longest = message.content
    if (!Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === 'text' && part.text.length > longest.length) longest = part.text
    }
  }
  return longest || undefined
}

function replaceText(messages: ApiMessage[], current: string, replacement: string): ApiMessage[] {
  let replaced = false
  return messages.map((message) => {
    if (replaced) return message
    if (typeof message.content === 'string' && message.content === current) {
      replaced = true
      return { ...message, content: replacement }
    }
    if (!Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (replaced || part.type !== 'text' || part.text !== current) return part
        replaced = true
        return { ...part, text: replacement }
      })
    }
  })
}

function payloadBytes(envelope: Record<string, unknown>, messages: ApiMessage[]): number {
  return Buffer.byteLength(JSON.stringify({ ...envelope, messages }), 'utf8')
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

function timeoutMessage(profile: ModelProfile): string {
  if (profile.source === 'grok') return 'A Grok nem válaszolt a megadott időkorláton belül. Növeld a válasz időkorlátot a Beállításokban, vagy próbáld újra.'
  if (profile.source === 'codex') return 'A Codex nem válaszolt a megadott időkorláton belül. Növeld a válasz időkorlátot a Beállításokban, vagy próbáld újra.'
  return 'A helyi modell nem válaszolt a megadott időkorláton belül. Növeld a válasz időkorlátot a Beállításokban.'
}

function completeError(error: unknown, profile: ModelProfile): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(timeoutMessage(profile))
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
  const text = await response.text()
  if (!text.trim()) return `${fallback} (${response.status})`
  try {
    return errorFromPayload(JSON.parse(text) as unknown, fallback, response.status)
  } catch {
    return sanitizeProviderMessage(text.trim(), response.status)
  }
}

function isPayloadTooLarge(message: string, status = 0): boolean {
  return status === 413 || /413|request entity too large|payload too large|body too large/i.test(message)
}

function sanitizeProviderMessage(message: string, status: number): string {
  if (isPayloadTooLarge(message, status)) {
    return 'A kérés túl nagy volt a modell szerverének. A nagy képek és fájlok nem fértek bele a méretkorlátba.'
  }
  if (/<html[\s>]/i.test(message)) {
    const title = message.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    if (title) return `A modell szervere hibát adott: ${title}`
    return message.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280)
  }
  return message.length > 500 ? `${message.slice(0, 500)}…` : message
}

function errorFromPayload(payload: unknown, fallback: string, status: number): string {
  if (!payload || typeof payload !== 'object') return `${fallback} (${status})`
  const record = payload as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown }
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  if (record.error && typeof record.error === 'object' && typeof record.error.message === 'string' && record.error.message.trim()) return record.error.message
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
  if (Array.isArray(record.detail)) {
    const parts = record.detail.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string') return (item as { msg: string }).msg
      return ''
    }).filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  return `${fallback} (${status})`
}
