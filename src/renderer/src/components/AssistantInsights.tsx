import { useEffect, useState } from 'react'
import { Brain, Check, ChevronDown, CircleAlert, ExternalLink, Globe2, LoaderCircle, Search } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getTranslator } from '../i18n'
import type { AiActivityStep, AppLanguage, ChatMessage } from '@shared/types'

interface AssistantInsightsProps {
  message: ChatMessage
  language: AppLanguage
}

export default function AssistantInsights({ message, language }: AssistantInsightsProps): React.JSX.Element | null {
  const t = getTranslator(language)
  const isStreaming = message.status === 'streaming'
  const hasTrace = Boolean(message.reasoning?.trim() || message.activity?.length)
  const [reasoningOpen, setReasoningOpen] = useState(isStreaming)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const reasoningId = `reasoning-${message.id}`
  const sourcesId = `sources-${message.id}`

  useEffect(() => {
    setReasoningOpen(isStreaming)
  }, [isStreaming])

  if (!hasTrace && !message.sources?.length) return null

  return (
    <div className="assistant-insights">
      {hasTrace ? (
        <section className={`reasoning-panel ${isStreaming ? 'streaming' : ''}`}>
          <button className="reasoning-trigger" type="button" aria-controls={reasoningId} aria-expanded={reasoningOpen} onClick={() => setReasoningOpen((open) => !open)}>
            <span className="reasoning-trigger-icon">{isStreaming ? <LoaderCircle size={14} /> : <Brain size={14} />}</span>
            <span>{isStreaming ? t('thinking') : t('workSummary')}</span>
            <ChevronDown className={reasoningOpen ? 'expanded' : ''} size={14} />
          </button>
          {reasoningOpen ? (
            <div className="reasoning-content" id={reasoningId}>
              {message.activity?.length ? <div className="activity-steps">{message.activity.map((step) => <ActivityStep key={step.id} language={language} step={step} />)}</div> : null}
              {message.reasoning?.trim() ? (
                <div className="published-reasoning">
                  <strong><Brain size={13} /> {t('publishedReasoning')}</strong>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.reasoning}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {message.sources?.length ? (
        <section className="sources-panel">
          <button className="sources-trigger" type="button" aria-controls={sourcesId} aria-expanded={sourcesOpen} onClick={() => setSourcesOpen((open) => !open)}>
            <span><Globe2 size={14} /> {t('sources')}</span>
            <span className="sources-count">{message.sources.length}</span>
            <ChevronDown className={sourcesOpen ? 'expanded' : ''} size={14} />
          </button>
          {sourcesOpen ? (
            <div className="source-list" id={sourcesId}>
              {message.sources.map((source, index) => (
                <a href={source.url} key={source.url} onClick={(event) => { event.preventDefault(); void window.loclm.web.openExternal(source.url) }}>
                  <span className="source-index">{index + 1}</span>
                  <span className="source-copy"><strong>{source.title}</strong><small>{hostname(source.url)}</small>{source.description ? <p>{source.description}</p> : null}</span>
                  <ExternalLink size={13} aria-label={t('openSource', { title: source.title })} />
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function ActivityStep({ step, language }: { step: AiActivityStep; language: AppLanguage }): React.JSX.Element {
  const t = getTranslator(language)
  const icon = step.status === 'active'
    ? <LoaderCircle className="spin" size={13} />
    : step.status === 'error'
      ? <CircleAlert size={13} />
      : step.status === 'complete'
        ? <Check size={13} />
        : step.type === 'web-search'
          ? <Search size={13} />
          : <Brain size={13} />

  return (
    <div className={`activity-step ${step.status}`}>
      <span>{icon}</span>
      <div><strong>{activityLabel(step, t)}</strong>{step.status === 'active' ? <small>{t('inProgress')}</small> : null}</div>
    </div>
  )
}

function activityLabel(step: AiActivityStep, t: ReturnType<typeof getTranslator>): string {
  if (step.status === 'error') return t('stepFailed')
  if (step.type === 'web-search') return step.status === 'complete' ? t('searchedWeb', { count: step.detail ?? 0 }) : t('searchingWeb')
  return step.status === 'complete' ? t('answerGenerated') : t('generatingAnswer')
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
