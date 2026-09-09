import type { AppSettings, GrokModelSettings, ModelProfile } from './types'

export const GROK_CHAT_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'

export function createDefaultGrokSettings(): GrokModelSettings {
  return {
    modelId: '',
    contextLength: 500_000,
    supportsVision: true
  }
}

export function createGrokProfile(grok: GrokModelSettings): ModelProfile {
  return {
    source: 'grok',
    providerName: 'Grok',
    baseUrl: GROK_CHAT_BASE_URL,
    modelId: grok.modelId,
    contextLength: grok.contextLength,
    supportsVision: grok.supportsVision
  }
}

export function activeModelProfile(settings: AppSettings): ModelProfile {
  if (settings.modelSource === 'grok') return createGrokProfile(settings.grok ?? createDefaultGrokSettings())
  return { ...settings.model, source: 'local' }
}

export function formatProfileLabel(profile?: ModelProfile | null): string {
  if (!profile?.modelId) return ''
  return profile.source === 'grok' ? `Grok · ${profile.modelId}` : profile.modelId
}

export function formatModelLabel(settings: AppSettings): string {
  return formatProfileLabel(activeModelProfile(settings))
}

export function resolveChatModel(chat: { model?: ModelProfile } | undefined, settings: AppSettings): ModelProfile {
  return chat?.model?.modelId ? chat.model : activeModelProfile(settings)
}

export function modelKey(profile: ModelProfile): string {
  return `${profile.source === 'grok' ? 'grok' : 'local'}:${profile.modelId}`
}
