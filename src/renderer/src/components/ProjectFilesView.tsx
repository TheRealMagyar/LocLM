import { ExternalLink, FileImage, FileText, FolderOpen, FolderPlus, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { getTranslator, localeFor } from '../i18n'
import type { AppLanguage, Attachment, Project } from '@shared/types'

interface ProjectFilesViewProps {
  project?: Project
  language: AppLanguage
  onAddFiles: () => void
  onOpenFile: (attachment: Attachment) => void
  onRevealFile: (attachment: Attachment) => void
  onRemoveFile: (attachment: Attachment) => void
}

export default function ProjectFilesView(props: ProjectFilesViewProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const t = getTranslator(props.language)
  const locale = localeFor(props.language)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase(locale))
  const files = props.project?.files ?? []
  const visibleFiles = deferredQuery
    ? files.filter((file) => file.name.toLocaleLowerCase(locale).includes(deferredQuery))
    : files
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <main className="files-main">
      <header className="files-header">
        <div className="files-heading">
          <span className="files-heading-icon"><FolderOpen size={18} /></span>
          <div><strong>{t('projectFiles')}</strong><span>{props.project?.name ?? t('chatProjectFallback')}</span></div>
        </div>
        <button className="primary-button" type="button" onClick={props.onAddFiles}><FolderPlus size={15} /> {t('addFile')}</button>
      </header>

      <section className="files-content">
        <div className="files-toolbar">
          <div><strong>{t('projectFilesCount', { count: files.length })}</strong><span>{t('projectFilesAvailable', { size: formatBytes(totalSize) })}</span></div>
          <label className="files-search"><Search size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchFile')} aria-label={t('projectFileSearch')} /></label>
        </div>

        {files.length === 0 ? (
          <div className="files-empty">
            <span><FolderOpen size={26} /></span>
            <h1>{t('emptyProjectFolder')}</h1>
            <p>{t('emptyProjectFolderDescription')}</p>
            <button className="secondary-button" type="button" onClick={props.onAddFiles}><FolderPlus size={15} /> {t('addFirstFile')}</button>
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="files-empty compact"><Search size={22} /><h1>{t('noResults')}</h1><p>{t('tryDifferentFileName')}</p></div>
        ) : (
          <div className="files-grid">
            {visibleFiles.map((file) => (
              <article className="file-card" key={file.id}>
                <button className="file-preview" type="button" disabled={!file.path} onClick={() => props.onOpenFile(file)} aria-label={t('openNamedFile', { name: file.name })}>
                  {file.mimeType.startsWith('image/') && file.previewDataUrl
                    ? <img src={file.previewDataUrl} alt="" />
                    : file.mimeType.startsWith('image/') ? <FileImage size={28} /> : <FileText size={28} />}
                </button>
                <div className="file-card-body"><strong title={file.name}>{file.name}</strong><span>{fileTypeLabel(file, props.language)} · {formatBytes(file.size)}</span></div>
                <div className="file-card-actions">
                  <button type="button" disabled={!file.path} onClick={() => props.onOpenFile(file)} aria-label={t('openNamedFile', { name: file.name })} title={t('open')}><ExternalLink size={14} /></button>
                  <button type="button" disabled={!file.path} onClick={() => props.onRevealFile(file)} aria-label={t('revealNamedFile', { name: file.name })} title={t('revealInFolder')}><FolderOpen size={14} /></button>
                  <button className="destructive" type="button" onClick={() => props.onRemoveFile(file)} aria-label={t('removeNamedFile', { name: file.name })} title={t('removeFromProject')}><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function fileTypeLabel(file: Attachment, language: AppLanguage): string {
  const t = getTranslator(language)
  if (file.mimeType.startsWith('image/')) return t('image')
  if (file.mimeType === 'application/pdf') return 'PDF'
  if (file.mimeType.includes('wordprocessingml')) return 'Word'
  if (file.mimeType.includes('json')) return 'JSON'
  return t('document')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
