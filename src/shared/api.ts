import type {
  Attachment,
  AppLanguage,
  CapturePayload,
  CaptureSelection,
  CaptureSource,
  ChatRequest,
  ChatStreamEvent,
  CodexConnectionStatus,
  FileReadResult,
  GmailConnectionStatus,
  GmailConfiguration,
  GmailDraftInput,
  GmailThreadSummary,
  GrokConnectionStatus,
  ModelDescriptor,
  ModelProfile,
  PersistedState,
  SecretSettings,
  UpdateState,
  WebSearchResult,
  WebSettings
} from './types'

export interface LoclmApi {
  state: {
    load: () => Promise<PersistedState>
    save: (state: PersistedState) => Promise<PersistedState>
  }
  secrets: {
    get: () => Promise<SecretSettings>
    set: (secrets: SecretSettings) => Promise<void>
  }
  models: {
    list: (profile: ModelProfile) => Promise<ModelDescriptor[]>
    test: (profile: ModelProfile) => Promise<{ latencyMs: number; models: ModelDescriptor[] }>
    startChat: (request: ChatRequest) => void
    abortChat: (requestId: string) => void
    complete: (request: ChatRequest) => Promise<string>
    onEvent: (callback: (event: ChatStreamEvent) => void) => () => void
  }
  files: {
    pick: () => Promise<FileReadResult[]>
    saveDataUrl: (dataUrl: string, suggestedName?: string) => Promise<Attachment>
    exportText: (title: string, content: string, format: 'docx' | 'pdf' | 'md' | 'txt') => Promise<string | undefined>
    open: (path: string) => Promise<void>
    reveal: (path: string) => Promise<void>
  }
  capture: {
    open: () => Promise<void>
    setShortcut: (shortcut: string, enabled: boolean) => Promise<boolean>
    getSource: () => Promise<CaptureSource>
    complete: (selection: CaptureSelection) => void
    cancel: () => void
    onCompleted: (callback: (payload: CapturePayload) => void) => () => void
  }
  gmail: {
    status: () => Promise<GmailConnectionStatus>
    configuration: () => Promise<GmailConfiguration>
    connect: (clientId?: string) => Promise<GmailConnectionStatus>
    disconnect: () => Promise<void>
    search: (query: string) => Promise<GmailThreadSummary[]>
    getThreadText: (threadId: string) => Promise<string>
    createDraft: (input: GmailDraftInput) => Promise<{ id: string }>
    sendDraft: (draftId: string) => Promise<void>
    modifyThread: (threadId: string, addLabelIds: string[], removeLabelIds: string[]) => Promise<void>
  }
  grok: {
    status: () => Promise<GrokConnectionStatus>
    connect: () => Promise<GrokConnectionStatus>
    disconnect: () => Promise<void>
  }
  codex: {
    status: () => Promise<CodexConnectionStatus>
    connect: () => Promise<CodexConnectionStatus>
    disconnect: () => Promise<CodexConnectionStatus>
  }
  web: {
    search: (query: string, settings: WebSettings, language: AppLanguage) => Promise<WebSearchResult[]>
    openExternal: (url: string) => Promise<void>
  }
  updater: {
    check: () => Promise<UpdateState>
    install: () => void
    onState: (callback: (state: UpdateState) => void) => () => void
  }
  app: {
    getInfo: () => Promise<{ version: string; platform: string }>
  }
  windowControls: {
    minimize: () => void
    toggleMaximize: () => Promise<boolean>
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
  }
}
