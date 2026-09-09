import { useEffect, useMemo, useRef, useState } from 'react'
import { Blocks, BookOpen, ChevronDown, FolderOpen, MessageSquare, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import BrandLogo from './BrandLogo'
import { getTranslator, localeFor } from '../i18n'
import type { AppLanguage, Chat, LearningGame, Project } from '@shared/types'

interface SidebarProps {
  projects: Project[]
  chats: Chat[]
  games: LearningGame[]
  activeProjectId: string
  activeChatId: string
  activeGameId?: string
  modelLabel: string
  runningByChat?: Record<string, string>
  activeView: 'chat' | 'files' | 'learn'
  language: AppLanguage
  onSelectProject: (id: string) => void
  onSelectChat: (id: string) => void
  onSelectGame: (id: string) => void
  onNewProject: () => void
  onNewChat: () => void
  onNewGame: () => void
  onOpenSettings: (tab?: string) => void
  onDeleteChat: (id: string) => void
  onDeleteGame: (id: string) => void
  onRenameProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
  onOpenChat: () => void
  onOpenFiles: () => void
  onOpenLearning: () => void
  onAddProjectFiles: () => void
}

export default function Sidebar(props: SidebarProps): React.JSX.Element {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const projectSwitcherRef = useRef<HTMLDivElement>(null)
  const t = getTranslator(props.language)
  const locale = localeFor(props.language)
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId)
  const projectChats = useMemo(() => props.chats
    .filter((chat) => chat.projectId === props.activeProjectId && chat.title.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [locale, props.activeProjectId, props.chats, query])
  const visibleGames = useMemo(() => props.games
    .filter((game) => (game.name || t('newLearningGame')).toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [locale, props.games, query, t])

  useEffect(() => {
    if (!projectMenuOpen) return

    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!projectSwitcherRef.current?.contains(event.target as Node)) setProjectMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setProjectMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [projectMenuOpen])

  return (
    <>
      <aside className="app-rail" aria-label={t('primaryNavigation')}>
        <BrandLogo className="rail-logo" size="medium" />
        <button className={`rail-button ${props.activeView === 'chat' ? 'active' : ''}`} type="button" aria-label={t('chats')} onClick={props.onOpenChat}><MessageSquare size={17} /></button>
        <button className="rail-button" type="button" aria-label={t('plugins')} onClick={() => props.onOpenSettings('plugins')}><Blocks size={17} /></button>
        <button className={`rail-button ${props.activeView === 'files' ? 'active' : ''}`} type="button" aria-label={t('projectFiles')} onClick={props.onOpenFiles}><FolderOpen size={17} /></button>
        <span className="rail-separator" />
        <button className={`rail-button ${props.activeView === 'learn' ? 'active' : ''}`} type="button" aria-label={t('learning')} onClick={props.onOpenLearning}><BookOpen size={17} /></button>
        <button className="rail-button rail-bottom" type="button" aria-label={t('settings')} onClick={() => props.onOpenSettings()}><Settings2 size={17} /></button>
      </aside>

      <aside className="project-sidebar">
        <div className="project-switcher-wrap" ref={projectSwitcherRef}>
          <button className="project-switcher" type="button" aria-controls="project-menu" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen((open) => !open)}>
            <span className="project-avatar">{activeProject?.name.slice(0, 1).toUpperCase() ?? 'L'}</span>
            <span>{activeProject?.name ?? t('project')}</span>
            <ChevronDown size={15} />
          </button>
          <button className="icon-button compact" type="button" aria-label={t('newProject')} onClick={props.onNewProject}><Plus size={16} /></button>
          {projectMenuOpen && (
            <div className="project-menu" id="project-menu">
              <div className="project-menu-label">{t('projects')}</div>
              {props.projects.map((project) => (
                <div className={`project-menu-row ${project.id === props.activeProjectId ? 'active' : ''}`} key={project.id}>
                  <button className="project-menu-select" type="button" onClick={() => { props.onSelectProject(project.id); setProjectMenuOpen(false) }}>
                    <span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><span>{project.name}</span>
                  </button>
                  <div className="project-menu-actions">
                    <button type="button" aria-label={`${t('rename')}: ${project.name}`} title={t('rename')} onClick={() => { props.onRenameProject(project); setProjectMenuOpen(false) }}><Pencil size={13} /></button>
                    <button className="destructive" type="button" aria-label={`${t('delete')}: ${project.name}`} title={t('delete')} onClick={() => { props.onDeleteProject(project); setProjectMenuOpen(false) }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
              <button className="project-menu-create" type="button" onClick={() => { props.onNewProject(); setProjectMenuOpen(false) }}><Plus size={15} /><span>{t('newProject')}</span></button>
            </div>
          )}
        </div>

        {props.activeView === 'learn'
          ? <button className="new-chat-button" type="button" onClick={props.onNewGame}><Plus size={16} /> {t('newLearningGame')}</button>
          : props.activeView === 'chat'
            ? <button className="new-chat-button" type="button" onClick={props.onNewChat}><Plus size={16} /> {t('newChat')}</button>
            : <button className="new-chat-button" type="button" onClick={props.onAddProjectFiles}><Plus size={16} /> {t('addFile')}</button>}

        <label className="sidebar-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={props.activeView === 'learn' ? t('searchGames') : t('searchChats')}
            aria-label={props.activeView === 'learn' ? t('searchGames') : t('searchChats')}
          />
        </label>

        <div className="sidebar-section-label">{props.activeView === 'learn' ? t('learningGames') : props.activeView === 'chat' ? t('conversations') : t('projectChats')}</div>
        {props.activeView === 'learn' ? (
          <nav className="chat-nav" aria-label={t('learningGames')}>
            {visibleGames.map((game) => (
              <div className={`chat-nav-row ${game.id === props.activeGameId ? 'active' : ''}`} key={game.id}>
                <button type="button" onClick={() => props.onSelectGame(game.id)}>
                  <BookOpen size={14} />
                  <span className="chat-nav-copy">
                    <span>{game.name || t('newLearningGame')}</span>
                    <small>{game.items.length ? t('generatedPreview', { count: game.items.length }) : t(game.type === 'fill-blank' ? 'fillBlankType' : game.type === 'match' ? 'matchType' : game.type === 'exam' ? 'examType' : 'quizType')}</small>
                  </span>
                </button>
                <button className="chat-row-menu" type="button" aria-label={`${t('delete')}: ${game.name || t('newLearningGame')}`} onClick={() => props.onDeleteGame(game.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </nav>
        ) : (
          <nav className="chat-nav" aria-label={t('conversations')}>
            {projectChats.map((chat) => (
              <div className={`chat-nav-row ${chat.id === props.activeChatId ? 'active' : ''} ${props.runningByChat?.[chat.id] ? 'running' : ''}`} key={chat.id}>
                <button type="button" onClick={() => props.onSelectChat(chat.id)}>
                  <MessageSquare size={14} />
                  <span className="chat-nav-copy">
                    <span>{chat.title}</span>
                    {props.runningByChat?.[chat.id] ? <small>{props.runningByChat[chat.id]}</small> : null}
                  </span>
                </button>
                <button className="chat-row-menu" type="button" aria-label={`${t('delete')}: ${chat.title}`} onClick={() => props.onDeleteChat(chat.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </nav>
        )}

        <div className="sidebar-runtime">
          <span className={`status-dot ${props.runningByChat?.[props.activeChatId] ? 'busy' : ''}`} />
          <span>{props.runningByChat?.[props.activeChatId] ? t('runningModel', { model: props.runningByChat[props.activeChatId] }) : (props.modelLabel || t('noModel'))}</span>
        </div>
      </aside>
    </>
  )
}
