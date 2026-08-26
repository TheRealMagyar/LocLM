import { useEffect, useMemo, useRef, useState } from 'react'
import { Blocks, ChevronDown, FolderOpen, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import BrandLogo from './BrandLogo'
import { getTranslator, localeFor } from '../i18n'
import type { AppLanguage, Chat, Project } from '@shared/types'

interface SidebarProps {
  projects: Project[]
  chats: Chat[]
  activeProjectId: string
  activeChatId: string
  modelLabel: string
  activeView: 'chat' | 'files'
  language: AppLanguage
  onSelectProject: (id: string) => void
  onSelectChat: (id: string) => void
  onNewProject: () => void
  onNewChat: () => void
  onOpenSettings: (tab?: string) => void
  onDeleteChat: (id: string) => void
  onRenameProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
  onOpenChat: () => void
  onOpenFiles: () => void
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

        {props.activeView === 'chat'
          ? <button className="new-chat-button" type="button" onClick={props.onNewChat}><Plus size={16} /> {t('newChat')}</button>
          : <button className="new-chat-button" type="button" onClick={props.onAddProjectFiles}><Plus size={16} /> {t('addFile')}</button>}

        <label className="sidebar-search">
          <Search size={14} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchChats')} aria-label={t('searchChats')} />
        </label>

        <div className="sidebar-section-label">{props.activeView === 'chat' ? t('conversations') : t('projectChats')}</div>
        <nav className="chat-nav" aria-label={t('conversations')}>
          {projectChats.map((chat) => (
            <div className={`chat-nav-row ${chat.id === props.activeChatId ? 'active' : ''}`} key={chat.id}>
              <button type="button" onClick={() => props.onSelectChat(chat.id)}>
                <MessageSquare size={14} />
                <span>{chat.title}</span>
              </button>
              <button className="chat-row-menu" type="button" aria-label={`${t('delete')}: ${chat.title}`} onClick={() => props.onDeleteChat(chat.id)}><MoreHorizontal size={14} /></button>
            </div>
          ))}
        </nav>

        <div className="sidebar-runtime">
          <span className="status-dot" />
          <span>{props.modelLabel || t('noModel')}</span>
        </div>
      </aside>
    </>
  )
}
