import type { AppLanguage, Attachment, LearningGame, LearningGameType, LearningItem, LearningResponse } from './types'

import type { ModelProfile } from './types'

const MAX_REFERENCE_CHARS = 24_000
const LOCAL_REFERENCE_CHARS = 6_000

export function isCloudModel(profile?: ModelProfile | null): boolean {
  return profile?.source === 'grok' || profile?.source === 'codex'
}

export function generationPlan(profile: ModelProfile | undefined, targetCount: number, type: LearningGameType = 'quiz'): {
  compact: boolean
  oneShot: boolean
  batchSize: number
  maxReferenceChars: number
  timeoutMs: number
  maxTokens: number
} {
  const count = Math.max(1, Math.min(40, targetCount || 10))
  const perItem = type === 'match' ? 200 : type === 'fill-blank' ? 90 : 130
  if (isCloudModel(profile)) {
    return {
      compact: true,
      oneShot: true,
      batchSize: count,
      maxReferenceChars: 10_000,
      timeoutMs: 90_000,
      maxTokens: Math.min(2_400, Math.max(500, 120 + count * perItem))
    }
  }
  return {
    compact: true,
    oneShot: false,
    batchSize: Math.min(4, count),
    maxReferenceChars: LOCAL_REFERENCE_CHARS,
    timeoutMs: 150_000,
    maxTokens: 1_400
  }
}

export function createLearningGame(partial?: Partial<LearningGame>): LearningGame {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'quiz',
    timed: false,
    timeLimitSeconds: 300,
    targetCount: 10,
    extraInstructions: '',
    references: [],
    items: [],
    attempts: [],
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

export function referenceContext(files: Attachment[], maxChars = MAX_REFERENCE_CHARS): string {
  const parts = files.map((file) => {
    const text = file.extractedText?.trim()
    return text ? `--- ${file.name} ---\n${text}` : `--- ${file.name} ---\n(No extractable text.)`
  })
  const joined = parts.join('\n\n')
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n\n[Truncated]` : joined
}

export function generationSystemPrompt(language: AppLanguage): string {
  return language === 'hu'
    ? 'Tananyagfejlesztő AI vagy. Csak érvényes JSON-t adj vissza, markdown nélkül. A feladatok a megadott forrásanyagból készüljenek, legyenek pontosak és egyértelműek.'
    : 'You are an educational content designer. Return only valid JSON, no markdown. Tasks must come from the supplied source material and be accurate and unambiguous.'
}

export function generationUserPrompt(game: LearningGame, language: AppLanguage, options?: { count?: number; compact?: boolean; maxReferenceChars?: number }): string {
  const compact = Boolean(options?.compact)
  const typeGuide: Record<LearningGameType, string> = language === 'hu'
    ? {
      quiz: compact ? 'Kvíz: 4 options, correctIndex 0-3. Rövid prompt.' : 'Feleletválasztós kvíz. Minden tételnél 4 options, correctIndex (0-3), explanation.',
      'fill-blank': compact ? 'Egy ___ a promptban. correctAnswers tömb.' : 'Mondat kiegészítés. A promptban pontosan egy ___ jelölje a hiányzó részt. correctAnswers: elfogadott megoldások.',
      match: compact ? 'pairs: {left,right}, 4-6 pár.' : 'Összekötős. prompt rövid utasítás, pairs: {left, right} párok (4-8 pár).',
      exam: compact ? '4 options, correctIndex. Max 1 tételnél requiresJustification true.' : 'Vizsgaszimulátor. 4 options, correctIndex. Kb. a tételek harmadánál requiresJustification: true.'
    }
    : {
      quiz: compact ? 'Quiz: 4 options, correctIndex 0-3. Short prompts.' : 'Multiple-choice quiz. Each item: 4 options, correctIndex (0-3), explanation.',
      'fill-blank': compact ? 'One ___ in the prompt. correctAnswers array.' : 'Fill-in-the-blank. Put exactly one ___ in the prompt for the missing part. correctAnswers: accepted solutions.',
      match: compact ? 'pairs: {left,right}, 4-6 pairs.' : 'Matching. Short prompt plus pairs: {left, right} (4-8 pairs).',
      exam: compact ? '4 options, correctIndex. requiresJustification true on at most one item.' : 'Exam simulator. 4 options, correctIndex. Set requiresJustification: true on about one third of items.'
    }

  const count = Math.max(1, Math.min(40, options?.count ?? game.targetCount ?? 10))
  const extras = game.extraInstructions.trim()
  const sources = referenceContext(game.references, options?.maxReferenceChars)
  const langLine = language === 'hu' ? 'A feladatok nyelve: magyar.' : 'Write the tasks in English.'
  const schema = compact
    ? 'JSON only: {"items":[{"prompt":"...","options":["A","B","C","D"],"correctIndex":0,"correctAnswers":["..."],"pairs":[{"left":"...","right":"..."}]}]}'
    : 'JSON shape: {"items":[{"type":"quiz|fill-blank|match|exam","prompt":"string","options":["..."],"correctIndex":0,"correctAnswers":["..."],"pairs":[{"left":"...","right":"..."}],"requiresJustification":false,"explanation":"string"}]}'

  return [
    `Create exactly ${count} items of type "${game.type}". Reply with JSON only.`,
    typeGuide[game.type],
    langLine,
    compact ? 'Keep prompts under 20 words. Skip explanation. No markdown.' : 'Omit unused fields. Do not wrap the JSON in code fences.',
    extras ? `Extra instructions from the user:\n${extras}` : '',
    sources ? `Source material:\n${sources}` : 'No source files were attached. Use general knowledge for the topic implied by the title and instructions.',
    schema
  ].filter(Boolean).join('\n\n')
}

export function evaluationSystemPrompt(language: AppLanguage): string {
  return language === 'hu'
    ? 'Tanárként csak az írásos indoklásokat értékeld. A feleletválasztós válasz helyességét a localCorrect mező rögzíti: hamis értéket soha ne minősíts helyesnek. Csak JSON-t adj vissza.'
    : 'Grade only the written justifications as a teacher. The objective answer is fixed by localCorrect: never mark a false localCorrect as correct. Return JSON only.'
}

export function needsWrittenEvaluation(game: LearningGame, responses: LearningResponse[]): boolean {
  return game.items.some((item) => {
    const response = responses.find((entry) => entry.itemId === item.id)
    return item.requiresJustification && response?.correct === true && Boolean(response.justification?.trim())
  })
}

export function evaluationUserPrompt(game: LearningGame, responses: LearningResponse[], language: AppLanguage): string {
  const payload = game.items.filter((item) => item.requiresJustification).map((item) => {
    const response = responses.find((entry) => entry.itemId === item.id)
    return {
      id: item.id,
      prompt: item.prompt,
      expected: item.correctAnswers?.[0] ?? (typeof item.correctIndex === 'number' ? item.options?.[item.correctIndex] : undefined),
      answer: response?.text ?? (typeof response?.selectedIndex === 'number' ? item.options?.[response.selectedIndex] : undefined),
      justification: response?.justification,
      localCorrect: response?.correct
    }
  })
  const langLine = language === 'hu' ? 'Az értékelés nyelve: magyar.' : 'Write the evaluation in English.'
  return [
    `Game: ${game.name} (${game.type}). Evaluate whether each justification demonstrates correct understanding. An item is correct only when localCorrect is true and the justification is adequate.`,
    langLine,
    'Return every supplied id. JSON only: {"score":0,"maxScore":0,"summary":"2 constructive sentences","items":[{"id":"...","correct":true,"feedback":"one specific, helpful sentence"}]}',
    JSON.stringify(payload)
  ].join('\n\n')
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped)
  const candidate = (fenced?.[1] ?? stripped).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return JSON.')
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
}

export function parseGeneratedItems(raw: string, type: LearningGameType): LearningItem[] {
  const payload = parseJsonObject(raw)
  const items = Array.isArray(payload.items) ? payload.items : []
  return items.map((entry, index) => normalizeItem(entry, type, index)).filter((item) => item.prompt.trim())
}

export function parseEvaluation(raw: string): { score: number; maxScore: number; summary: string; items: Array<{ id: string; correct: boolean; feedback: string }> } {
  const payload = parseJsonObject(raw)
  const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : []
  return {
    score: Number(payload.score) || 0,
    maxScore: Number(payload.maxScore) || items.length,
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    items: items.map((item) => ({
      id: String(item.id ?? ''),
      correct: item.correct === true || item.correct === 'true',
      feedback: typeof item.feedback === 'string' ? item.feedback : ''
    })).filter((item) => item.id)
  }
}

export function scoreLocally(item: LearningItem, response?: LearningResponse): boolean {
  if (!response) return false
  if (item.type === 'fill-blank') {
    const given = normalizeAnswer(response.text ?? '')
    return Boolean(given) && (item.correctAnswers ?? []).some((answer) => normalizeAnswer(answer) === given)
  }
  if (item.type === 'match') {
    const expected = new Map((item.pairs ?? []).map((pair) => [pair.left, pair.right]))
    const got = response.matches ?? []
    if (got.length !== expected.size) return false
    return got.every((pair) => expected.get(pair.left) === pair.right)
  }
  return response.selectedIndex === item.correctIndex
}

function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[.!?,;:]+$/u, '')
    .replace(/\s+/g, ' ')
}

function normalizeItem(entry: unknown, fallbackType: LearningGameType, index: number): LearningItem {
  const value = (entry && typeof entry === 'object') ? entry as Record<string, unknown> : {}
  const type = isGameType(value.type) ? value.type : fallbackType
  const options = Array.isArray(value.options) ? value.options.map((option) => String(option)) : undefined
  const pairs = Array.isArray(value.pairs)
    ? value.pairs.map((pair) => {
      const item = pair && typeof pair === 'object' ? pair as Record<string, unknown> : {}
      return { left: String(item.left ?? ''), right: String(item.right ?? '') }
    }).filter((pair) => pair.left && pair.right)
    : undefined
  const correctAnswers = Array.isArray(value.correctAnswers)
    ? value.correctAnswers.map((answer) => String(answer))
    : typeof value.correctAnswer === 'string' ? [value.correctAnswer] : undefined

  return {
    id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    type,
    prompt: String(value.prompt ?? value.question ?? `Item ${index + 1}`),
    options,
    correctIndex: typeof value.correctIndex === 'number' ? value.correctIndex : undefined,
    correctAnswers,
    pairs,
    requiresJustification: Boolean(value.requiresJustification),
    explanation: typeof value.explanation === 'string' ? value.explanation : undefined
  }
}

function isGameType(value: unknown): value is LearningGameType {
  return value === 'quiz' || value === 'fill-blank' || value === 'match' || value === 'exam'
}
