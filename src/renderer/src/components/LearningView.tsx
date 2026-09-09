import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Check, Clock, FileText, Link2, ListChecks, PenLine, Play, Plus, Sparkles, Timer, Trash2, X } from 'lucide-react'
import { getTranslator } from '../i18n'
import ModelPicker, { type ChatModelOption } from './ModelPicker'
import {
  evaluationSystemPrompt,
  evaluationUserPrompt,
  generationPlan,
  generationSystemPrompt,
  generationUserPrompt,
  isCloudModel,
  needsWrittenEvaluation,
  parseEvaluation,
  parseGeneratedItems,
  scoreLocally
} from '@shared/learning'
import { formatProfileLabel, modelKey, resolveChatModel } from '@shared/model'
import type {
  AppLanguage,
  AppSettings,
  Attachment,
  LearningGame,
  LearningGameType,
  LearningItem,
  LearningResponse,
  ModelProfile,
  Project
} from '@shared/types'

interface LearningViewProps {
  project?: Project
  game?: LearningGame
  language: AppLanguage
  model: ModelProfile
  modelOptions: ChatModelOption[]
  settings: AppSettings
  busy: boolean
  onCreate: () => void
  onChange: (game: LearningGame) => void
  onDelete: (gameId: string) => void
  onPickReferences: () => Promise<Attachment[]>
  onSelectModel: (key: string) => void
}

type Screen = 'home' | 'edit' | 'play' | 'results'

export default function LearningView(props: LearningViewProps): React.JSX.Element {
  const t = getTranslator(props.language)
  const [screen, setScreen] = useState<Screen>(props.game ? 'edit' : 'home')
  const [index, setIndex] = useState(0)
  const [responses, setResponses] = useState<Record<string, LearningResponse>>({})
  const [remaining, setRemaining] = useState<number>()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const finishingRef = useRef(false)
  const startedAtRef = useRef<string | undefined>(undefined)
  const game = props.game
  const itemsById = useMemo(() => new Map((game?.items ?? []).map((item) => [item.id, item])), [game?.items])
  const latestResponsesById = useMemo(() => new Map((game?.attempts[0]?.responses ?? []).map((response) => [response.itemId, response])), [game?.attempts])

  useEffect(() => {
    setScreen(props.game ? 'edit' : 'home')
    setIndex(0)
    setResponses({})
    setRemaining(undefined)
    setStatus('')
    finishingRef.current = false
    startedAtRef.current = undefined
  }, [props.game?.id])

  useEffect(() => {
    if (screen !== 'play' || !game?.timed) return
    setRemaining(game.timeLimitSeconds)
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value === undefined) return value
        if (value <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [screen, game?.id, game?.timed, game?.timeLimitSeconds])

  useEffect(() => {
    if (screen === 'play' && remaining === 0 && game) void finishAttempt(true)
  }, [remaining])

  const patch = (update: Partial<LearningGame>): void => {
    if (!game) return
    props.onChange({ ...game, ...update, updatedAt: new Date().toISOString() })
  }

  const startPlay = (): void => {
    if (!game?.items.length) return
    finishingRef.current = false
    setResponses({})
    setIndex(0)
    startedAtRef.current = new Date().toISOString()
    setScreen('play')
  }

  const currentItem = game?.items[index]
  const currentResponse = currentItem ? responses[currentItem.id] : undefined

  const updateResponse = (itemId: string, update: Partial<LearningResponse>): void => {
    setResponses((current) => ({
      ...current,
      [itemId]: { ...current[itemId], itemId, ...update }
    }))
  }

  const generate = async (): Promise<void> => {
    if (!game) return
    const model = resolveChatModel({ model: game.model }, props.settings)
    if (!model.modelId) {
      setStatus(t('noModel'))
      return
    }
    const plan = generationPlan(model, game.targetCount, game.type)
    const generationReferences = dedupeFiles([...(props.project?.files ?? []), ...game.references])
    setBusy(true)
    const collected: LearningItem[] = []
    try {
      while (collected.length < game.targetCount) {
        const batch = Math.min(plan.batchSize, game.targetCount - collected.length)
        setStatus(t('generatingBatch', { from: collected.length + 1, to: collected.length + batch, total: game.targetCount }))
        const raw = await window.loclm.models.complete({
          requestId: crypto.randomUUID(),
          chatId: game.id,
          model,
          maxTokens: plan.maxTokens,
          timeoutMs: plan.timeoutMs,
          jsonComplete: true,
          systemPrompt: generationSystemPrompt(props.language),
          messages: [{
            id: crypto.randomUUID(),
            role: 'user',
            content: generationUserPrompt({ ...game, name: game.name || t('newLearningGame'), references: generationReferences }, props.language, {
              count: batch,
              compact: plan.compact,
              maxReferenceChars: plan.maxReferenceChars
            }),
            createdAt: new Date().toISOString(),
            status: 'complete'
          }]
        })
        const parsed = parseGeneratedItems(raw, game.type)
        if (!parsed.length) break
        collected.push(...parsed)
        if (plan.oneShot) break
      }
      const items = collected.slice(0, game.targetCount)
      if (!items.length) throw new Error(t('generationEmpty'))
      patch({ items, model })
      setStatus(t('generatedTasks', { count: items.length }))
    } catch (error) {
      if (collected.length) {
        patch({ items: collected, model })
        setStatus(`${t('generatedTasks', { count: collected.length })} · ${error instanceof Error ? error.message : String(error)}`)
      } else {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setBusy(false)
    }
  }

  const finishAttempt = async (timedOut = false): Promise<void> => {
    if (!game || finishingRef.current) return
    finishingRef.current = true
    const list = game.items.map((item) => responses[item.id] ?? { itemId: item.id })
    setBusy(true)
    setStatus(t('evaluatingAnswers'))
    try {
      let scored = list.map((response) => {
        const item = itemsById.get(response.itemId)
        if (!item) return response
        const localCorrect = scoreLocally(item, response)
        if (item.requiresJustification && !response.justification?.trim()) {
          return { ...response, correct: false, feedback: t('missingJustification') }
        }
        return { ...response, correct: localCorrect }
      })
      let evaluation = ''
      const model = resolveChatModel({ model: game.model }, props.settings)
      if (model.modelId && needsWrittenEvaluation(game, scored)) {
        try {
          const raw = await window.loclm.models.complete({
            requestId: crypto.randomUUID(),
            chatId: game.id,
            model,
            maxTokens: 700,
            timeoutMs: isCloudModel(model) ? 45_000 : 40_000,
            jsonComplete: true,
            systemPrompt: evaluationSystemPrompt(props.language),
            messages: [{
              id: crypto.randomUUID(),
              role: 'user',
              content: evaluationUserPrompt(game, scored, props.language),
              createdAt: new Date().toISOString(),
              status: 'complete'
            }]
          })
          const parsed = parseEvaluation(raw)
          evaluation = parsed.summary
          scored = scored.map((response) => {
            const item = itemsById.get(response.itemId)
            if (!item?.requiresJustification) return response
            const judged = parsed.items.find((entry) => entry.id === response.itemId)
            return judged
              ? { ...response, correct: response.correct === true && judged.correct, feedback: judged.feedback || response.feedback }
              : response
          })
        } catch {
          evaluation = t('writtenEvaluationUnavailable')
        }
      } else if (scored.some((response) => {
        const item = itemsById.get(response.itemId)
        return item?.requiresJustification && Boolean(response.justification?.trim())
      })) {
        evaluation = t('writtenEvaluationUnavailable')
      }
      const score = scored.filter((response) => response.correct).length
      evaluation = [t('localScoreSummary', { score, total: game.items.length }), evaluation].filter(Boolean).join(' ')
      const attempt = {
        id: crypto.randomUUID(),
        startedAt: startedAtRef.current ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
        timedOut,
        responses: scored,
        score,
        maxScore: game.items.length,
        evaluation
      }
      patch({ attempts: [attempt, ...game.attempts].slice(0, 20) })
      setResponses(Object.fromEntries(scored.map((response) => [response.itemId, response])))
      setScreen('results')
      setStatus('')
    } catch (error) {
      const scored = list.map((response) => {
        const item = itemsById.get(response.itemId)
        return item ? { ...response, correct: scoreLocally(item, response) } : response
      })
      patch({
        attempts: [{
          id: crypto.randomUUID(),
          startedAt: startedAtRef.current ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
          timedOut,
          responses: scored,
          score: scored.filter((response) => response.correct).length,
          maxScore: game.items.length,
          evaluation: error instanceof Error ? error.message : String(error)
        }, ...game.attempts].slice(0, 20)
      })
      setResponses(Object.fromEntries(scored.map((response) => [response.itemId, response])))
      setScreen('results')
    } finally {
      setBusy(false)
    }
  }

  const addReferences = async (): Promise<void> => {
    if (!game) return
    const files = await props.onPickReferences()
    if (!files.length) return
    patch({ references: dedupeFiles([...game.references, ...files]) })
  }

  if (!game) {
    return (
      <main className="learn-main">
        <header className="files-header">
          <div className="files-heading">
            <span className="files-heading-icon"><BookOpen size={18} /></span>
            <div><strong>{t('learning')}</strong><span>{props.project?.name ?? t('chatProjectFallback')}</span></div>
          </div>
          <button className="primary-button" type="button" onClick={props.onCreate}><Plus size={15} /> {t('newLearningGame')}</button>
        </header>
        <div className="files-empty">
          <span><BookOpen size={26} /></span>
          <h1>{t('emptyLearning')}</h1>
          <p>{t('emptyLearningDescription')}</p>
          <button className="secondary-button" type="button" onClick={props.onCreate}><Plus size={15} /> {t('newLearningGame')}</button>
        </div>
      </main>
    )
  }

  if (screen === 'play' && currentItem) {
    return (
      <main className="learn-main">
        <header className="files-header">
          <div className="files-heading">
            <button className="icon-button compact" type="button" aria-label={t('back')} onClick={() => setScreen('edit')}><ArrowLeft size={16} /></button>
            <div><strong>{game.name || t('newLearningGame')}</strong><span>{t('taskProgress', { current: index + 1, total: game.items.length })}</span></div>
          </div>
          {game.timed ? <div className={`learn-timer ${remaining !== undefined && remaining <= 15 ? 'urgent' : ''}`}><Timer size={15} /> {formatClock(remaining ?? game.timeLimitSeconds)}</div> : null}
        </header>
        <section className="learn-content">
          <div className="learn-progress"><span style={{ width: `${((index + 1) / game.items.length) * 100}%` }} /></div>
          <PlayItem
            item={currentItem}
            response={currentResponse}
            language={props.language}
            onChange={(update) => updateResponse(currentItem.id, update)}
          />
          <div className="learn-actions">
            <button className="secondary-button" type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>{t('previous')}</button>
            {index + 1 < game.items.length
              ? <button className="primary-button" type="button" onClick={() => setIndex((value) => value + 1)}>{t('next')}</button>
              : <button className="primary-button" type="button" disabled={busy} onClick={() => void finishAttempt(false)}>{busy ? t('evaluatingAnswers') : t('finishAndEvaluate')}</button>}
          </div>
        </section>
      </main>
    )
  }

  if (screen === 'results') {
    const latest = game.attempts[0]
    const score = latest?.score ?? 0
    const total = latest?.maxScore ?? game.items.length
    const answered = game.items.filter((item) => isAnswered(item, latestResponsesById.get(item.id) ?? responses[item.id])).length
    const percent = total > 0 ? Math.round((score / total) * 100) : 0
    return (
      <main className="learn-main">
        <header className="files-header">
          <div className="files-heading">
            <button className="icon-button compact" type="button" aria-label={t('back')} onClick={() => setScreen('edit')}><ArrowLeft size={16} /></button>
            <div><strong>{t('results')}</strong><span>{game.name || t('newLearningGame')}</span></div>
          </div>
          <button className="secondary-button" type="button" onClick={startPlay}><Play size={15} /> {t('playAgain')}</button>
        </header>
        <section className="learn-content">
          <div className="learn-score">
            <strong>{t('scorePercent', { score, total, percent })}</strong>
            <div className="learn-score-meta">
              <span>{latest?.timedOut ? t('timeUp') : t('evaluationSummary')}</span>
              <span>{t('answeredCount', { answered, total: game.items.length })}</span>
            </div>
          </div>
          {latest?.evaluation ? <p className="learn-summary">{latest.evaluation}</p> : null}
          <div className="learn-review">
            {game.items.map((item, itemIndex) => {
              const response = latestResponsesById.get(item.id) ?? responses[item.id]
              return (
                <article className={`learn-review-card ${response?.correct ? 'correct' : 'incorrect'}`} key={item.id}>
                  <header>
                    <span>{itemIndex + 1}</span>
                    <strong>{item.prompt}</strong>
                    <span className="learn-result-badge">
                      {response?.correct ? <Check size={14} /> : <X size={14} />}
                      {response?.correct ? t('correctResult') : t('incorrectResult')}
                    </span>
                  </header>
                  <div className="learn-answer-grid">
                    <div><span>{t('yourAnswer')}</span><strong>{formatResponse(item, response, t('unanswered'))}</strong></div>
                    <div><span>{t('correctAnswer')}</span><strong>{formatCorrectAnswer(item, t('unanswered'))}</strong></div>
                  </div>
                  {response?.justification ? <div className="learn-justification"><span>{t('justifyAnswer')}</span><p>{response.justification}</p></div> : null}
                  {response?.feedback ? <p className="learn-feedback">{response.feedback}</p> : item.explanation ? <p className="learn-feedback">{item.explanation}</p> : null}
                </article>
              )
            })}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="learn-main">
      <header className="files-header learn-edit-header">
        <div className="files-heading">
          <span className="files-heading-icon"><BookOpen size={18} /></span>
          <div><strong>{t('learning')}</strong><span>{game.name || t('newLearningGame')}</span></div>
        </div>
        <div className="learn-header-actions">
          <ModelPicker
            language={props.language}
            options={props.modelOptions}
            selectedKey={modelKey(resolveChatModel({ model: game.model }, props.settings))}
            selectedLabel={formatProfileLabel(resolveChatModel({ model: game.model }, props.settings))}
            generating={busy}
            onChange={props.onSelectModel}
          />
          {game.items.length > 0 ? <button className="primary-button" type="button" disabled={busy} onClick={startPlay}><Play size={15} /> {t('startGame')}</button> : null}
          <button className="icon-button compact learn-delete-button" type="button" disabled={busy} title={t('deleteGame')} aria-label={t('deleteGame')} onClick={() => props.onDelete(game.id)}><Trash2 size={15} /></button>
        </div>
      </header>
      <section className="learn-content" aria-busy={busy}>
        <label className="field"><span>{t('gameName')}</span><input autoFocus value={game.name} disabled={busy} onChange={(event) => patch({ name: event.target.value })} placeholder={t('gameNameExample')} /></label>
        <div className="learn-type-grid">
          {(['quiz', 'fill-blank', 'match', 'exam'] as LearningGameType[]).map((type) => (
            <button className={`learn-type-card ${game.type === type ? 'active' : ''}`} type="button" key={type} disabled={busy} onClick={() => patch({ type, items: game.type === type ? game.items : [] })}>
              {typeIcon(type)}
              <strong>{t(typeLabelKey(type))}</strong>
              <small>{t(typeHintKey(type))}</small>
            </button>
          ))}
        </div>
        <div className="field-grid two-columns">
          <label className="field"><span>{t('taskCount')}</span><input type="number" min="1" max="40" value={game.targetCount} disabled={busy} onChange={(event) => patch({ targetCount: Math.max(1, Math.min(40, Number(event.target.value) || 10)) })} /></label>
          <label className="field"><span>{t('timeLimitSeconds')}</span><input type="number" min="30" step="30" value={game.timeLimitSeconds} disabled={busy || !game.timed} onChange={(event) => patch({ timeLimitSeconds: Math.max(30, Number(event.target.value) || 300) })} /></label>
        </div>
        <div className="setting-row">
          <div><strong>{t('timedQuiz')}</strong><small>{t('timedQuizDescription')}</small></div>
          <button className={`switch ${game.timed ? 'checked' : ''}`} type="button" role="switch" aria-checked={game.timed} aria-label={t('timedQuiz')} disabled={busy} onClick={() => patch({ timed: !game.timed })}><span /></button>
        </div>
        <label className="field"><span>{t('generationNotes')}</span><textarea rows={3} value={game.extraInstructions} disabled={busy} onChange={(event) => patch({ extraInstructions: event.target.value })} placeholder={t('generationNotesPlaceholder')} /></label>
        <div className="learn-references">
          <div className="learn-references-head">
            <strong>{t('referenceMaterial')}</strong>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void addReferences()}><Plus size={14} /> {t('addReference')}</button>
          </div>
          <p className="muted-text">{t('referenceMaterialHint')}</p>
          {props.project?.files.length ? <p className="learn-project-context">{t('projectFilesAiContext', { count: props.project.files.length })}</p> : null}
          {game.references.length ? (
            <ul className="learn-file-list">
              {game.references.map((file) => (
                <li key={file.id}>
                  <FileText size={15} />
                  <span>{file.name}</span>
                  <small>{file.extractedText ? t('textExtracted') : t('noExtractedText')}</small>
                  <button type="button" disabled={busy} aria-label={t('removeAttachment', { name: file.name })} onClick={() => patch({ references: game.references.filter((item) => item.id !== file.id) })}><X size={13} /></button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="settings-note"><Sparkles size={15} /> {isCloudModel(resolveChatModel({ model: game.model }, props.settings)) ? t('cloudGenerationHint') : t('localGenerationHint')}</div>
        <div className="settings-action-row">
          <button className="primary-button" type="button" disabled={busy || props.busy} onClick={() => void generate()}><Sparkles size={15} /> {busy ? t('generatingTasks') : t('generateWithAi')}</button>
          {status ? <span className="muted-text">{status}</span> : null}
        </div>
        {game.items.length > 0 ? (
          <div className="learn-preview">
            <strong>{t('generatedPreview', { count: game.items.length })}</strong>
            {game.items.slice(0, 6).map((item, itemIndex) => (
              <div className="learn-preview-item" key={item.id}><span>{itemIndex + 1}</span><p>{item.prompt}</p></div>
            ))}
            {game.items.length > 6 ? <small className="muted-text">{t('moreTasks', { count: game.items.length - 6 })}</small> : null}
          </div>
        ) : null}
        {game.attempts[0] ? <p className="muted-text">{t('lastScore', { score: game.attempts[0].score ?? 0, total: game.attempts[0].maxScore ?? game.items.length })}</p> : null}
      </section>
    </main>
  )
}

function PlayItem({ item, response, language, onChange }: { item: LearningItem; response?: LearningResponse; language: AppLanguage; onChange: (update: Partial<LearningResponse>) => void }): React.JSX.Element {
  const t = getTranslator(language)
  if (item.type === 'fill-blank') {
    const parts = item.prompt.split('___')
    return (
      <article className="learn-play-card">
        <p className="learn-prompt">
          {parts.map((part, index) => (
            <span key={`${item.id}-${index}`}>
              {part}
              {index < parts.length - 1 ? (
                <input className="learn-blank" value={response?.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} aria-label={t('yourAnswer')} />
              ) : null}
            </span>
          ))}
        </p>
      </article>
    )
  }
  if (item.type === 'match') {
    return <MatchBoard item={item} response={response} language={language} onChange={onChange} />
  }
  return (
    <article className="learn-play-card">
      <p className="learn-prompt">{item.prompt}</p>
      <div className="learn-options">
        {(item.options ?? []).map((option, optionIndex) => (
          <button className={`learn-option ${response?.selectedIndex === optionIndex ? 'active' : ''}`} type="button" key={option} onClick={() => onChange({ selectedIndex: optionIndex })}>
            <span>{String.fromCharCode(65 + optionIndex)}</span>
            {option}
          </button>
        ))}
      </div>
      {item.requiresJustification ? (
        <label className="field"><span>{t('justifyAnswer')}</span><textarea rows={3} value={response?.justification ?? ''} onChange={(event) => onChange({ justification: event.target.value })} /></label>
      ) : null}
    </article>
  )
}

function MatchBoard({ item, response, language, onChange }: { item: LearningItem; response?: LearningResponse; language: AppLanguage; onChange: (update: Partial<LearningResponse>) => void }): React.JSX.Element {
  const t = getTranslator(language)
  const pairs = item.pairs ?? []
  const rights = useMemo(() => shuffle(pairs.map((pair) => pair.right)), [item.id])
  const [selectedLeft, setSelectedLeft] = useState<string>()
  const matches = response?.matches ?? []
  const usedRights = new Set(matches.map((pair) => pair.right))
  const usedLefts = new Set(matches.map((pair) => pair.left))

  const connect = (left: string, right: string): void => {
    onChange({ matches: [...matches.filter((pair) => pair.left !== left && pair.right !== right), { left, right }] })
    setSelectedLeft(undefined)
  }

  return (
    <article className="learn-play-card">
      <p className="learn-prompt">{item.prompt || t('matchHint')}</p>
      <div className="learn-match">
        <div>
          {pairs.map((pair) => (
            <button className={`learn-match-item ${selectedLeft === pair.left ? 'active' : ''} ${usedLefts.has(pair.left) ? 'used' : ''}`} type="button" key={pair.left} disabled={usedLefts.has(pair.left)} onClick={() => setSelectedLeft(pair.left)}>{pair.left}</button>
          ))}
        </div>
        <div>
          {rights.map((right) => (
            <button className={`learn-match-item ${usedRights.has(right) ? 'used' : ''}`} type="button" key={right} disabled={usedRights.has(right) || !selectedLeft} onClick={() => selectedLeft && connect(selectedLeft, right)}>{right}</button>
          ))}
        </div>
      </div>
      {matches.length > 0 ? (
        <ul className="learn-match-made">
          {matches.map((pair) => (
            <li key={`${pair.left}-${pair.right}`}>
              <Link2 size={13} /> {pair.left} — {pair.right}
              <button type="button" onClick={() => onChange({ matches: matches.filter((item) => item.left !== pair.left) })}><X size={12} /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function isAnswered(item: LearningItem, response?: LearningResponse): boolean {
  if (!response) return false
  if (item.type === 'fill-blank') return Boolean(response.text?.trim())
  if (item.type === 'match') return Boolean(response.matches?.length)
  return typeof response.selectedIndex === 'number'
}

function formatResponse(item: LearningItem, response: LearningResponse | undefined, fallback: string): string {
  if (!response) return fallback
  if (item.type === 'fill-blank') return response.text?.trim() || fallback
  if (item.type === 'match') return formatPairs(response.matches) || fallback
  return formatOption(item.options, response.selectedIndex, fallback)
}

function formatCorrectAnswer(item: LearningItem, fallback: string): string {
  if (item.type === 'fill-blank') return item.correctAnswers?.join(' / ') || fallback
  if (item.type === 'match') return formatPairs(item.pairs) || fallback
  return formatOption(item.options, item.correctIndex, fallback)
}

function formatOption(options: string[] | undefined, index: number | undefined, fallback: string): string {
  if (typeof index !== 'number' || !options?.[index]) return fallback
  return `${String.fromCharCode(65 + index)}. ${options[index]}`
}

function formatPairs(pairs: LearningResponse['matches']): string {
  return (pairs ?? []).map((pair) => `${pair.left} — ${pair.right}`).join(' · ')
}

function typeIcon(type: LearningGameType): React.ReactNode {
  if (type === 'fill-blank') return <PenLine size={18} />
  if (type === 'match') return <Link2 size={18} />
  if (type === 'exam') return <ListChecks size={18} />
  return <Clock size={18} />
}

function typeLabelKey(type: LearningGameType): 'quizType' | 'fillBlankType' | 'matchType' | 'examType' {
  if (type === 'fill-blank') return 'fillBlankType'
  if (type === 'match') return 'matchType'
  if (type === 'exam') return 'examType'
  return 'quizType'
}

function typeHintKey(type: LearningGameType): 'quizTypeHint' | 'fillBlankTypeHint' | 'matchTypeHint' | 'examTypeHint' {
  if (type === 'fill-blank') return 'fillBlankTypeHint'
  if (type === 'match') return 'matchTypeHint'
  if (type === 'exam') return 'examTypeHint'
  return 'quizTypeHint'
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swap]
    copy[swap] = current
  }
  return copy
}

function dedupeFiles(files: Attachment[]): Attachment[] {
  return [...new Map(files.map((file) => [file.id, file])).values()]
}
