import type { AppSettings, CodexModelSettings, GrokModelSettings, ModelProfile } from './types'

export const GROK_CHAT_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'
export const CODEX_CLI_BASE_URL = 'codex-cli://local'

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

export function createDefaultCodexSettings(): CodexModelSettings {
  return {
    modelId: '',
    contextLength: 272_000,
    supportsVision: true
  }
}

export function createCodexProfile(codex: CodexModelSettings): ModelProfile {
  return {
    source: 'codex',
    providerName: 'Codex CLI',
    baseUrl: CODEX_CLI_BASE_URL,
    modelId: codex.modelId,
    contextLength: codex.contextLength,
    supportsVision: codex.supportsVision
  }
}

export function activeModelProfile(settings: AppSettings): ModelProfile {
  if (settings.modelSource === 'grok') return createGrokProfile(settings.grok ?? createDefaultGrokSettings())
  if (settings.modelSource === 'codex') return createCodexProfile(settings.codex ?? createDefaultCodexSettings())
  return { ...settings.model, source: 'local' }
}

export function formatProfileLabel(profile?: ModelProfile | null): string {
  if (!profile?.modelId) return ''
  if (profile.source === 'grok') return `Grok · ${profile.modelId}`
  if (profile.source === 'codex') return `Codex · ${profile.modelId}`
  return profile.modelId
}

export function formatModelLabel(settings: AppSettings): string {
  return formatProfileLabel(activeModelProfile(settings))
}

export function resolveChatModel(chat: { model?: ModelProfile } | undefined, settings: AppSettings): ModelProfile {
  return chat?.model?.modelId ? chat.model : activeModelProfile(settings)
}

export function modelKey(profile: ModelProfile): string {
  return `${profile.source === 'grok' ? 'grok' : profile.source === 'codex' ? 'codex' : 'local'}:${profile.modelId}`
}
