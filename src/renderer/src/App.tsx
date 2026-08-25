import { useEffect, useRef, useState } from 'react'
import { FolderPlus, Pencil, Trash2 } from 'lucide-react'
import BrandLogo from './components/BrandLogo'
import ChatView from './components/ChatView'
import Modal from './components/Modal'
import ProjectFilesView from './components/ProjectFilesView'
import SettingsPanel from './components/SettingsPanel'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import type {
  AppSettings,
  Attachment,
  Chat,
  ChatMessage,
  ChatStreamEvent,
  GmailConnectionStatus,
  PersistedState,
  Project,
  SecretSettings,
  UpdateState,
  WebSearchResult
} from '@shared/types'

interface ActiveRequest {
  requestId: string
  chatId: string
  assistantMessageId: string
}

const timestamp = (): string => new Date().toISOString()

export default function App(): React.JSX.Element {
  const [state, setState] = useState<PersistedState>()
  const [secrets, setSecrets] = useState<SecretSettings>({})
  const [gmailStatus, setGmailStatus] = useState<GmailConnectionStatus>({ connected: false })
  const [appInfo, setAppInfo] = useState({ version: '0.1.0', platform: 'desktop' })
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [prompt, setPrompt] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [webEnabled, setWebEnabled] = useState(false)
  const [gmailEnabled, setGmailEnabled] = useState(false)
  const [activeRequest, setActiveRequest] = useState<ActiveRequest>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('model')
  const [activeView, setActiveView] = useState<'chat' | 'files'>('chat')
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [renameTarget, setRenameTarget] = useState<Project>()
  const [renameProjectName, setRenameProjectName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Project>()
  const [toast, setToast] = useState('')

  const hydratedRef = useRef(false)
  const stateRef = useRef<PersistedState | undefined>(undefined)
  const activeRequestRef = useRef<ActiveRequest | undefined>(undefined)
  const sendPromptRef = useRef<(text: string, attachments?: Attachment[]) => Promise<void>>(async () => undefined)

  useEffect(() => {
    void Promise.all([
      window.loclm.state.load(),
      window.loclm.secrets.get(),
      window.loclm.gmail.status(),
      window.loclm.app.getInfo()
    ]).then(([loadedState, loadedSecrets, loadedGmail, loadedInfo]) => {
      stateRef.current = loadedState
      setState(loadedState)
      setSecrets(loadedSecrets)
      setGmailStatus(loadedGmail)
      setAppInfo(loadedInfo)
      hydratedRef.current = true
    })
  }, [])

  useEffect(() => {
    stateRef.current = state
    if (!state || !hydratedRef.current) return
    const timeout = window.setTimeout(() => void window.loclm.state.save(state), 350)
    document.documentElement.dataset.theme = state.settings.theme
    return () => window.clearTimeout(timeout)
  }, [state])

  useEffect(() => {
    activeRequestRef.current = activeRequest
  }, [activeRequest])

  useEffect(() => {
    const unsubscribeChat = window.loclm.models.onEvent(handleStreamEvent)
    const unsubscribeCapture = window.loclm.capture.onCompleted((payload) => {
      void window.loclm.files.saveDataUrl(payload.dataUrl, 'Képernyőkivágás.png').then((attachment) => {
        const current = stateRef.current
        if (current?.settings.capture.autoAnalyze) {
          void sendPromptRef.current('Elemezd a kijelölt képernyőrészletet. Írd le, mit látsz, és emeld ki a fontos részleteket.', [attachment])
        } else {
          setPendingAttachments((items) => [...items, attachment])
          setState((value) => value ? addProjectFiles(value, value.activeProjectId, [attachment]) : value)
        }
      })
    })
    const unsubscribeUpdater = window.loclm.updater.onState(setUpdateState)
    return () => {
      unsubscribeChat()
      unsubscribeCapture()
      unsubscribeUpdater()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const handleStreamEvent = (event: ChatStreamEvent): void => {
    const request = activeRequestRef.current
    if (!request || request.requestId !== event.requestId) return
    setState((current) => current ? updateMessage(current, request.chatId, request.assistantMessageId, (message) => {
      if (event.type === 'chunk') return { ...message, content: message.content + (event.content ?? ''), status: 'streaming' }
      if (event.type === 'error') return { ...message, content: event.error ?? 'A modell nem válaszolt.', status: 'error' }
      return { ...message, status: 'complete' }
    }) : current)
    if (event.type === 'done' || event.type === 'error') setActiveRequest(undefined)
  }

  const openSettings = (tab = 'model'): void => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }

  const createProject = (): void => {
    const name = newProjectName.trim()
    if (!name || !state) return
    const projectId = crypto.randomUUID()
    const chatId = crypto.randomUUID()
    const date = timestamp()
    const project: Project = {
      id: projectId,
      name,
      createdAt: date,
      updatedAt: date,
      defaultModelId: state.settings.model.modelId,
      systemPrompt: 'Segítőkész, pontos, helyi AI-asszisztens vagy.',
      enabledPlugins: Object.entries(state.settings.plugins).filter(([, enabled]) => enabled).map(([plugin]) => plugin as Project['enabledPlugins'][number]),
      files: []
    }
    const chat: Chat = { id: chatId, projectId, title: 'Új beszélgetés', createdAt: date, updatedAt: date, messages: [] }
    setState({ ...state, projects: [...state.projects, project], chats: [...state.chats, chat], activeProjectId: projectId, activeChatId: chatId })
    setNewProjectName('')
    setNewProjectOpen(false)
    setActiveView('chat')
  }

  const createChat = (): void => {
    if (!state) return
    const id = crypto.randomUUID()
    const date = timestamp()
    const chat: Chat = { id, projectId: state.activeProjectId, title: 'Új beszélgetés', createdAt: date, updatedAt: date, messages: [] }
    setState({ ...state, chats: [...state.chats, chat], activeChatId: id })
    setPendingAttachments([])
    setPrompt('')
    setActiveView('chat')
  }

  const selectProject = (projectId: string): void => {
    if (!state) return
    const existing = state.chats.find((chat) => chat.projectId === projectId)
    if (existing) {
      setState({ ...state, activeProjectId: projectId, activeChatId: existing.id })
      return
    }
    const id = crypto.randomUUID()
    const date = timestamp()
    const chat: Chat = { id, projectId, title: 'Új beszélgetés', createdAt: date, updatedAt: date, messages: [] }
    setState({ ...state, chats: [...state.chats, chat], activeProjectId: projectId, activeChatId: id })
  }

  const deleteChat = (chatId: string): void => {
    if (!state || !window.confirm('Törlöd ezt a beszélgetést?')) return
    const remaining = state.chats.filter((chat) => chat.id !== chatId)
    const projectChats = remaining.filter((chat) => chat.projectId === state.activeProjectId)
    if (projectChats.length) {
      setState({ ...state, chats: remaining, activeChatId: projectChats[0].id })
    } else {
      const id = crypto.randomUUID()
      const date = timestamp()
      const replacement: Chat = { id, projectId: state.activeProjectId, title: 'Új beszélgetés', createdAt: date, updatedAt: date, messages: [] }
      setState({ ...state, chats: [...remaining, replacement], activeChatId: id })
    }
  }

  const openRenameProject = (project: Project): void => {
    setRenameTarget(project)
    setRenameProjectName(project.name)
  }

  const renameProject = (): void => {
    const name = renameProjectName.trim()
    if (!renameTarget || !name) return
    setState((current) => current ? {
      ...current,
      projects: current.projects.map((project) => project.id === renameTarget.id ? { ...project, name, updatedAt: timestamp() } : project)
    } : current)
    setRenameTarget(undefined)
    setRenameProjectName('')
    setToast(`A projekt új neve: ${name}`)
  }

  const deleteProject = (): void => {
    if (!state || !deleteTarget) return
    const target = deleteTarget
    const targetChatIds = new Set(state.chats.filter((chat) => chat.projectId === target.id).map((chat) => chat.id))
    if (activeRequest && targetChatIds.has(activeRequest.chatId)) abort()

    const remainingProjects = state.projects.filter((project) => project.id !== target.id)
    const remainingChats = state.chats.filter((chat) => chat.projectId !== target.id)
    if (state.activeProjectId !== target.id) {
      setState({ ...state, projects: remainingProjects, chats: remainingChats })
    } else if (remainingProjects.length > 0) {
      const nextProject = remainingProjects[0]
      const nextProjectChat = remainingChats.find((chat) => chat.projectId === nextProject.id)
      if (nextProjectChat) {
        setState({ ...state, projects: remainingProjects, chats: remainingChats, activeProjectId: nextProject.id, activeChatId: nextProjectChat.id })
      } else {
        const date = timestamp()
        const chat: Chat = { id: crypto.randomUUID(), projectId: nextProject.id, title: 'Új beszélgetés', createdAt: date, updatedAt: date, messages: [] }
        setState({ ...state, projects: remainingProjects, chats: [...remainingChats, chat], activeProjectId: nextProject.id, activeChatId: chat.id })
      }
    } else {
      const date = timestamp()
      const projectId = crypto.randomUUID()
      const chatId = crypto.randomUUID()
      const replacementProject: Project = {
        id: projectId,
        name: 'LocLM',
        createdAt: date,
        updatedAt: date,
        defaultModelId: state.settings.model.modelId,
        systemPrompt: 'Segítőkész, pontos, helyi AI-asszisztens vagy.',
        enabledPlugins: Object.entries(state.settings.plugins).filter(([, enabled]) => enabled).map(([plugin]) => plugin as Project['enabledPlugins'][number]),
        files: []
      }
      const replacementChat: Chat = { id: chatId, projectId, title: 'Új beszélgetés', createdAt: date, updatedAt: date, messages: [] }
      setState({ ...state, projects: [replacementProject], chats: [replacementChat], activeProjectId: projectId, activeChatId: chatId })
    }
    setPendingAttachments([])
    setPrompt('')
    setDeleteTarget(undefined)
    setToast(`„${target.name}” projekt törölve`)
  }

  const sendPrompt = async (text: string, attachments = pendingAttachments): Promise<void> => {
    const current = stateRef.current
    if (!current || activeRequestRef.current || (!text.trim() && !attachments.length)) return
    const chat = current.chats.find((item) => item.id === current.activeChatId)
    const project = current.projects.find((item) => item.id === current.activeProjectId)
    if (!chat || !project) return

    const date = timestamp()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim() || 'Elemezd a csatolt fájlt.',
      createdAt: date,
      status: 'complete',
      attachments
    }
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: date,
      status: 'streaming'
    }
    const title = chat.messages.length === 0 ? createTitle(userMessage.content) : chat.title
    const nextMessages = [...chat.messages, userMessage]
    const nextState = addProjectFiles(
      updateChat(current, chat.id, (item) => ({ ...item, title, updatedAt: date, messages: [...nextMessages, assistantMessage] })),
      project.id,
      attachments
    )
    setState(nextState)
    stateRef.current = nextState
    setPrompt('')
    setPendingAttachments([])

    const request: ActiveRequest = { requestId: crypto.randomUUID(), chatId: chat.id, assistantMessageId: assistantMessage.id }
    activeRequestRef.current = request
    setActiveRequest(request)

    try {
      const pluginContext = await buildPluginContext(userMessage.content, webEnabled, gmailEnabled, current)
      window.loclm.models.startChat({
        requestId: request.requestId,
        chatId: chat.id,
        model: current.settings.model,
        systemPrompt: `${project.systemPrompt}${pluginContext}`,
        messages: nextMessages
      })
    } catch (error) {
      handleStreamEvent({ requestId: request.requestId, type: 'error', error: errorMessage(error) })
    }
  }
  sendPromptRef.current = sendPrompt

  const attachFiles = async (addToComposer = true): Promise<void> => {
    try {
      const results = await window.loclm.files.pick()
      const attachments = results.map((result) => result.attachment)
      if (!attachments.length) return
      setState((current) => current ? addProjectFiles(current, current.activeProjectId, attachments) : current)
      if (addToComposer) setPendingAttachments((items) => deduplicateFiles([...items, ...attachments]))
      setToast(`${attachments.length} fájl hozzáadva a projekthez`)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  const openProjectFile = async (attachment: Attachment): Promise<void> => {
    if (!attachment.path) return
    try {
      await window.loclm.files.open(attachment.path)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  const revealProjectFile = async (attachment: Attachment): Promise<void> => {
    if (!attachment.path) return
    try {
      await window.loclm.files.reveal(attachment.path)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  const removeProjectFile = (attachment: Attachment): void => {
    setState((current) => current ? {
      ...current,
      projects: current.projects.map((project) => project.id === current.activeProjectId
        ? { ...project, files: project.files.filter((file) => file.id !== attachment.id), updatedAt: timestamp() }
        : project)
    } : current)
    setToast(`„${attachment.name}” eltávolítva a projektből`)
  }

  const abort = (): void => {
    if (!activeRequest) return
    window.loclm.models.abortChat(activeRequest.requestId)
    activeRequestRef.current = undefined
    setState((current) => current ? updateMessage(current, activeRequest.chatId, activeRequest.assistantMessageId, (message) => ({ ...message, status: 'complete' })) : current)
    setActiveRequest(undefined)
  }

  const updateSettings = (settings: AppSettings): void => {
    setState((current) => {
      if (!current) return current
      const projects = current.projects.map((project) => project.id === current.activeProjectId
        ? { ...project, defaultModelId: settings.model.modelId, updatedAt: timestamp() }
        : project)
      return { ...current, settings, projects }
    })
  }

  const exportMessage = async (title: string, content: string, format: 'docx' | 'pdf'): Promise<void> => {
    try {
      const path = await window.loclm.files.exportText(title, content, format)
      if (path) setToast(`Exportálva: ${path}`)
    } catch (error) {
      setToast(errorMessage(error))
    }
  }

  if (!state) return <div className="loading-screen"><BrandLogo size="large" /><span>LocLM betöltése…</span></div>

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId)
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId)

  return (
    <div className="app-shell">
      <TitleBar projectName={activeProject?.name} />
      <Sidebar
        projects={state.projects}
        chats={state.chats}
        activeProjectId={state.activeProjectId}
        activeChatId={state.activeChatId}
        modelLabel={state.settings.model.modelId}
        activeView={activeView}
        onSelectProject={selectProject}
        onSelectChat={(activeChatId) => { setState({ ...state, activeChatId }); setActiveView('chat') }}
        onNewProject={() => setNewProjectOpen(true)}
        onNewChat={createChat}
        onOpenSettings={openSettings}
        onDeleteChat={deleteChat}
        onRenameProject={openRenameProject}
        onDeleteProject={setDeleteTarget}
        onOpenChat={() => setActiveView('chat')}
        onOpenFiles={() => setActiveView('files')}
        onAddProjectFiles={() => void attachFiles(false)}
      />
      {activeView === 'chat' ? (
        <ChatView
          chat={activeChat}
          project={activeProject}
          prompt={prompt}
          attachments={pendingAttachments}
          webEnabled={webEnabled}
          gmailEnabled={gmailEnabled}
          generating={Boolean(activeRequest)}
          onPromptChange={setPrompt}
          onSend={() => void sendPrompt(prompt)}
          onAttach={() => void attachFiles()}
          onCapture={() => void window.loclm.capture.open()}
          onToggleWeb={() => state.settings.plugins.web ? setWebEnabled((value) => !value) : openSettings('plugins')}
          onToggleGmail={() => state.settings.plugins.gmail && gmailStatus.connected ? setGmailEnabled((value) => !value) : openSettings('plugins')}
          onRemoveAttachment={(id) => setPendingAttachments((items) => items.filter((item) => item.id !== id))}
          onAbort={abort}
          onOpenSettings={() => openSettings('model')}
          onExport={(title, content, format) => void exportMessage(title, content, format)}
        />
      ) : (
        <ProjectFilesView
          project={activeProject}
          onAddFiles={() => void attachFiles(false)}
          onOpenFile={(attachment) => void openProjectFile(attachment)}
          onRevealFile={(attachment) => void revealProjectFile(attachment)}
          onRemoveFile={removeProjectFile}
        />
      )}
      <SettingsPanel
        open={settingsOpen}
        initialTab={settingsTab}
        settings={state.settings}
        secrets={secrets}
        gmailStatus={gmailStatus}
        appInfo={appInfo}
        updateState={updateState}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={updateSettings}
        onSecretsChange={setSecrets}
        onGmailStatusChange={setGmailStatus}
      />
      {newProjectOpen && (
        <Modal title="Új projekt" description="A projekt saját chateket, fájlokat és AI-beállításokat kap." onClose={() => setNewProjectOpen(false)}>
          <label className="field"><span>Projekt neve</span><input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createProject()} placeholder="Például: Kutatás" /></label>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setNewProjectOpen(false)}>Mégse</button><button className="primary-button" type="button" disabled={!newProjectName.trim()} onClick={createProject}><FolderPlus size={15} /> Projekt létrehozása</button></div>
        </Modal>
      )}
      {renameTarget && (
        <Modal title="Projekt átnevezése" description="A chatek és a projektfájlok változatlanul megmaradnak." onClose={() => setRenameTarget(undefined)}>
          <label className="field"><span>Új név</span><input autoFocus value={renameProjectName} onChange={(event) => setRenameProjectName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && renameProject()} /></label>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setRenameTarget(undefined)}>Mégse</button><button className="primary-button" type="button" disabled={!renameProjectName.trim()} onClick={renameProject}><Pencil size={15} /> Átnevezés</button></div>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title="Projekt törlése?" description={`A(z) „${deleteTarget.name}” projekt és minden chatje eltűnik a LocLM-ből. A lemezen tárolt csatolmányokat ez nem törli.`} onClose={() => setDeleteTarget(undefined)}>
          <div className="modal-warning"><Trash2 size={17} /><span>Ez a művelet az alkalmazáson belül nem vonható vissza.</span></div>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDeleteTarget(undefined)}>Mégse</button><button className="danger-button" type="button" onClick={deleteProject}><Trash2 size={15} /> Projekt törlése</button></div>
        </Modal>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function updateChat(state: PersistedState, chatId: string, updater: (chat: Chat) => Chat): PersistedState {
  return { ...state, chats: state.chats.map((chat) => chat.id === chatId ? updater(chat) : chat) }
}

function updateMessage(state: PersistedState, chatId: string, messageId: string, updater: (message: ChatMessage) => ChatMessage): PersistedState {
  return updateChat(state, chatId, (chat) => ({
    ...chat,
    updatedAt: timestamp(),
    messages: chat.messages.map((message) => message.id === messageId ? updater(message) : message)
  }))
}

function addProjectFiles(state: PersistedState, projectId: string, files: Attachment[]): PersistedState {
  if (!files.length) return state
  return {
    ...state,
    projects: state.projects.map((project) => project.id === projectId
      ? { ...project, files: deduplicateFiles([...project.files, ...files]), updatedAt: timestamp() }
      : project)
  }
}

function deduplicateFiles(files: Attachment[]): Attachment[] {
  return [...new Map(files.map((file) => [file.id, file])).values()]
}

function createTitle(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim()
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean || 'Új beszélgetés'
}

async function buildPluginContext(query: string, useWeb: boolean, useGmail: boolean, state: PersistedState): Promise<string> {
  const sections: string[] = []
  if (useWeb) {
    const results = await window.loclm.web.search(query, state.settings.web)
    sections.push(formatWebContext(results))
  }
  if (useGmail) {
    const threads = await window.loclm.gmail.search(query)
    const details = await Promise.all(threads.slice(0, 3).map(async (thread) => ({ thread, text: await window.loclm.gmail.getThreadText(thread.id) })))
    sections.push(`\n\nA felhasználó által engedélyezett Gmail-környezet:\n${details.map(({ thread, text }) => `### ${thread.subject}\n${text.slice(0, 12000)}`).join('\n\n')}`)
  }
  return sections.join('')
}

function formatWebContext(results: WebSearchResult[]): string {
  if (!results.length) return '\n\nA webes keresés nem adott találatot.'
  return `\n\nFriss webes keresési találatok. Hivatkozz a megadott URL-ekre:\n${results.map((result, index) => `${index + 1}. ${result.title}\nURL: ${result.url}\n${result.description}`).join('\n\n')}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
