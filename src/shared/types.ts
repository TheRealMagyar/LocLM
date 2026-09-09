export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageStatus = 'complete' | 'streaming' | 'error'
export type AppLanguage = 'en' | 'hu'

export interface Attachment {
  id: string
  name: string
  mimeType: string
  size: number
  path?: string
  previewDataUrl?: string
  extractedText?: string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  status: MessageStatus
  attachments?: Attachment[]
  reasoning?: string
  sources?: WebSearchResult[]
  activity?: AiActivityStep[]
  queued?: boolean
  modelId?: string
  modelLabel?: string
}

export type AiActivityType = 'web-search' | 'generating'
export type AiActivityStatus = 'pending' | 'active' | 'complete' | 'error'

export interface AiActivityStep {
  id: string
  type: AiActivityType
  status: AiActivityStatus
  detail?: string
}

export interface Chat {
  id: string
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  model?: ModelProfile
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  defaultModelId: string
  systemPrompt: string
  enabledPlugins: PluginId[]
  files: Attachment[]
  learningGames: LearningGame[]
}

export type LearningGameType = 'quiz' | 'fill-blank' | 'match' | 'exam'

export interface LearningPair {
  left: string
  right: string
}

export interface LearningItem {
  id: string
  type: LearningGameType
  prompt: string
  options?: string[]
  correctIndex?: number
  correctAnswers?: string[]
  pairs?: LearningPair[]
  requiresJustification?: boolean
  explanation?: string
}

export interface LearningResponse {
  itemId: string
  selectedIndex?: number
  text?: string
  justification?: string
  matches?: LearningPair[]
  correct?: boolean
  feedback?: string
}

export interface LearningAttempt {
  id: string
  startedAt: string
  completedAt?: string
  timedOut?: boolean
  responses: LearningResponse[]
  score?: number
  maxScore?: number
  evaluation?: string
}

export interface LearningGame {
  id: string
  name: string
  type: LearningGameType
  timed: boolean
  timeLimitSeconds: number
  targetCount: number
  extraInstructions: string
  references: Attachment[]
  items: LearningItem[]
  attempts: LearningAttempt[]
  model?: ModelProfile
  createdAt: string
  updatedAt: string
}

export type PluginId = 'web' | 'vision' | 'documents'
export type ModelSource = 'local' | 'grok' | 'codex'

export interface ModelProfile {
  source?: ModelSource
  providerName: string
  baseUrl: string
  modelId: string
  contextLength: number
  supportsVision: boolean
}

export interface GrokModelSettings {
  modelId: string
  contextLength: number
  supportsVision: boolean
}

export interface CodexModelSettings {
  modelId: string
  contextLength: number
  supportsVision: boolean
}

export interface CaptureSettings {
  enabled: boolean
  shortcut: string
  autoAnalyze: boolean
  ephemeral: boolean
}

export interface UpdateSettings {
  autoCheck: boolean
  autoDownload: boolean
  installOnQuit: boolean
}

export interface WebSettings {
  provider: 'browser' | 'brave' | 'searxng'
  browserEngine: 'automatic'
  searxngUrl: string
}

export interface AppSettings {
  language: AppLanguage
  theme: 'system' | 'light' | 'dark'
  modelSource: ModelSource
  model: ModelProfile
  grok: GrokModelSettings
  codex: CodexModelSettings
  capture: CaptureSettings
  updates: UpdateSettings
  web: WebSettings
  plugins: Record<PluginId, boolean>
}

export interface PersistedState {
  projects: Project[]
  chats: Chat[]
  activeProjectId: string
  activeChatId: string
  settings: AppSettings
}

export interface SecretSettings {
  modelApiKey?: string
  braveApiKey?: string
}

export interface ModelDescriptor {
  id: string
  ownedBy?: string
  name?: string
  contextLength?: number
}

export interface GrokConnectionStatus {
  connected: boolean
  email?: string
}

export interface CodexConnectionStatus {
  installed: boolean
  connected: boolean
  version?: string
  authMode?: string
  executablePath?: string
  error?: string
}

export interface ChatRequest {
  requestId: string
  chatId: string
  model: ModelProfile
  apiKey?: string
  systemPrompt: string
  messages: ChatMessage[]
  maxTokens?: number
  timeoutMs?: number
  jsonComplete?: boolean
}

export interface ChatStreamEvent {
  requestId: string
  type: 'chunk' | 'reasoning' | 'done' | 'error'
  content?: string
  error?: string
}

export interface CapturePayload {
  dataUrl: string
  width: number
  height: number
}

export interface CaptureSource extends CapturePayload {
  displayId: string
}

export interface CaptureSelection {
  sourceDataUrl: string
  sourceWidth: number
  sourceHeight: number
  displayWidth: number
  displayHeight: number
  x: number
  y: number
  width: number
  height: number
}

export interface FileReadResult {
  attachment: Attachment
}

export interface WebSearchResult {
  title: string
  url: string
  description: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}
