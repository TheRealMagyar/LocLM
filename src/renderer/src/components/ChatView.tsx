import { useEffect, useRef } from 'react'
import { ArrowUp, Camera, FileText, Globe2, Mail, Paperclip, Square, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Attachment, Chat, Project } from '@shared/types'
import BrandLogo from './BrandLogo'
import { getTranslator } from '../i18n'
import type { AppLanguage } from '@shared/types'

interface ChatViewProps {
  chat?: Chat
  project?: Project
  prompt: string
  attachments: Attachment[]
  webEnabled: boolean
  gmailEnabled: boolean
  generating: boolean
  language: AppLanguage
  onPromptChange: (value: string) => void
  onSend: () => void
  onAttach: () => void
  onCapture: () => void
  onToggleWeb: () => void
  onToggleGmail: () => void
  onRemoveAttachment: (id: string) => void
  onAbort: () => void
  onOpenSettings: () => void
  onExport: (title: string, content: string, format: 'docx' | 'pdf') => void
}

export default function ChatView(props: ChatViewProps): React.JSX.Element {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const t = getTranslator(props.language)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [props.chat?.messages])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    props.onSend()
  }

  return (
    <main className="chat-main">
      <header className="chat-header">
        <div className="chat-heading">
          <strong>{props.chat?.title ?? t('newConversation')}</strong>
          <span>{props.project?.name ?? t('chatProjectFallback')}</span>
        </div>
        <button className="runtime-chip" type="button" onClick={props.onOpenSettings}>
          <span className="status-dot" /> {props.project?.defaultModelId || 'Helyi modell'}
        </button>
      </header>

      <section className="messages" aria-live="polite">
        {!props.chat?.messages.length && (
          <div className="empty-chat">
            <BrandLogo className="empty-logo" size="large" />
            <h1>{t('howCanIHelp')}</h1>
            <p>{t('chatEmptyDescription')}</p>
            <div className="suggestions">
              <button type="button" onClick={props.onCapture}><Camera size={16} /><span><strong>{t('screenAnalysis')}</strong><small>{t('screenAnalysisHint')}</small></span></button>
              <button type="button" onClick={props.onAttach}><FileText size={16} /><span><strong>{t('documentProcessing')}</strong><small>{t('documentProcessingHint')}</small></span></button>
              <button type="button" onClick={props.onToggleWeb}><Globe2 size={16} /><span><strong>{t('webResearch')}</strong><small>{t('webResearchHint')}</small></span></button>
            </div>
          </div>
        )}

        {props.chat?.messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className={`message-avatar ${message.role === 'assistant' ? 'assistant' : ''}`}>{message.role === 'assistant' ? <BrandLogo size="small" /> : 'TE'}</div>
            <div className="message-body">
              {message.attachments?.length ? (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => attachment.mimeType.startsWith('image/') && attachment.previewDataUrl
                    ? <img key={attachment.id} src={attachment.previewDataUrl} alt={attachment.name} />
                    : <div className="file-attachment" key={attachment.id}><FileText size={15} /><span>{attachment.name}</span></div>)}
                </div>
              ) : null}
              {message.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.loclm.web.openExternal(href) }}>{children}</a>
                  }}
                >{message.content}</ReactMarkdown>
              ) : message.status === 'streaming' ? <div className="typing-indicator"><span /><span /><span /></div> : null}
              {message.status === 'error' && <div className="message-error">{t('responseInterrupted')}</div>}
              {message.role === 'assistant' && message.status === 'complete' && message.content && (
                <div className="message-actions">
                  <button type="button" onClick={() => props.onExport(props.chat?.title ?? t('loclmResponse'), message.content, 'docx')}>Word</button>
                  <button type="button" onClick={() => props.onExport(props.chat?.title ?? t('loclmResponse'), message.content, 'pdf')}>PDF</button>
                </div>
              )}
            </div>
          </article>
        ))}
        <div ref={messagesEndRef} />
      </section>

      <form className="composer-wrap" onSubmit={submit}>
        <div className="composer">
          {props.attachments.length > 0 && (
            <div className="pending-attachments">
              {props.attachments.map((attachment) => (
                <div className="pending-attachment" key={attachment.id}>
                  {attachment.previewDataUrl ? <img src={attachment.previewDataUrl} alt="" /> : <FileText size={16} />}
                  <span>{attachment.name}</span>
                  <button type="button" aria-label={t('removeAttachment', { name: attachment.name })} onClick={() => props.onRemoveAttachment(attachment.id)}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={props.prompt}
            placeholder={t('askPlaceholder')}
            aria-label={t('message')}
            rows={1}
            onChange={(event) => props.onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                props.onSend()
              }
            }}
          />
          <div className="composer-toolbar">
            <button className="tool-button" type="button" onClick={props.onAttach}><Paperclip size={15} /> {t('file')}</button>
            <button className="tool-button" type="button" onClick={props.onCapture}><Camera size={15} /> {t('capture')}</button>
            <button className={`tool-button ${props.webEnabled ? 'active' : ''}`} type="button" aria-pressed={props.webEnabled} onClick={props.onToggleWeb}><Globe2 size={15} /> {t('web')}</button>
            <button className={`tool-button ${props.gmailEnabled ? 'active' : ''}`} type="button" aria-pressed={props.gmailEnabled} onClick={props.onToggleGmail}><Mail size={15} /> {t('gmail')}</button>
            {props.generating
              ? <button className="send-button" type="button" aria-label={t('stopGeneration')} onClick={props.onAbort}><Square size={13} fill="currentColor" /></button>
              : <button className="send-button" type="submit" aria-label={t('send')} disabled={!props.prompt.trim() && props.attachments.length === 0}><ArrowUp size={16} /></button>}
          </div>
        </div>
        <div className="composer-note">{t('pluginPermissionNote')}</div>
      </form>
    </main>
  )
}
