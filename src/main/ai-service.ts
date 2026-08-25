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

  async listModels(profile: ModelProfile, apiKey?: string): Promise<ModelDescriptor[]> {
    const response = await fetch(`${normalizeBaseUrl(profile.baseUrl)}/models`, {
      headers: authHeaders(apiKey)
    })
    if (!response.ok) throw new Error(await responseError(response, 'A modellek lekérése sikertelen.'))
    const payload = await response.json() as { data?: Array<{ id: string; owned_by?: string }> }
    return (payload.data ?? []).map((model) => ({ id: model.id, ownedBy: model.owned_by }))
  }

  async testConnection(profile: ModelProfile, apiKey?: string): Promise<{ latencyMs: number; models: ModelDescriptor[] }> {
    const startedAt = performance.now()
    const models = await this.listModels(profile, apiKey)
    return { latencyMs: Math.round(performance.now() - startedAt), models }
  }

  async startChat(request: ChatRequest, target: WebContents): Promise<void> {
    if (!request.model.modelId) throw new Error('Előbb válassz egy helyi modellt a Beállításokban.')
    const controller = new AbortController()
    this.controllers.set(request.requestId, controller)

    try {
      const messages = await this.toApiMessages(request.systemPrompt, request.messages)
      const response = await fetch(`${normalizeBaseUrl(request.model.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          ...authHeaders(request.apiKey),
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

      if (!response.ok) throw new Error(await responseError(response, 'A helyi modell nem válaszolt.'))
      if (!response.body) throw new Error('A modell üres választ adott.')

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        this.emit(target, { requestId: request.requestId, type: 'chunk', content: payload.choices?.[0]?.message?.content ?? '' })
        this.emit(target, { requestId: request.requestId, type: 'done' })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

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
            const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
            const content = payload.choices?.[0]?.delta?.content
            if (content) this.emit(target, { requestId: request.requestId, type: 'chunk', content })
          } catch {
            // Ignore provider-specific keepalive chunks.
          }
        }
      }
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
  return baseUrl.trim().replace(/\/+$/, '')
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
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
