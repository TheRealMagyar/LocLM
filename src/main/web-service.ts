import { BrowserWindow } from 'electron'
import type { AppLanguage, WebSearchResult, WebSettings } from '../shared/types'

const SEARCH_TIMEOUT_MS = 15_000
const BROWSER_RESULT_SCRIPT = `(() => {
  const selectors = [
    ['.result', '.result__a', '.result__snippet'],
    ['li.b_algo', 'h2 a', '.b_caption p'],
    ['[data-testid="result"]', 'a[data-testid="result-title-a"]', '[data-testid="result-snippet"]'],
    ['.web-result', 'h2 a, a.result-link', '.result-snippet']
  ];
  const results = [];
  const seen = new Set();
  for (const [rowSelector, linkSelector, snippetSelector] of selectors) {
    for (const row of document.querySelectorAll(rowSelector)) {
      const link = row.querySelector(linkSelector);
      if (!(link instanceof HTMLAnchorElement) || !link.href || seen.has(link.href)) continue;
      seen.add(link.href);
      results.push({
        title: (link.textContent || '').trim(),
        url: link.href,
        description: (row.querySelector(snippetSelector)?.textContent || '').trim()
      });
      if (results.length >= 8) return results;
    }
  }
  return results;
})()`

interface RawBrowserResult {
  title: string
  url: string
  description: string
}

export class WebSearchService {
  private readonly activeWindows = new Set<BrowserWindow>()

  async search(query: string, settings: WebSettings, braveApiKey: string | undefined, language: AppLanguage): Promise<WebSearchResult[]> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    const startedAt = Date.now()
    console.info('[web-search] started', { provider: settings.provider, queryLength: normalizedQuery.length })
    try {
      let results: WebSearchResult[]
      if (settings.provider === 'browser') results = await this.searchBrowser(normalizedQuery, language)
      else if (settings.provider === 'searxng') results = await this.searchSearxng(normalizedQuery, settings.searxngUrl, language)
      else {
        if (!braveApiKey?.trim()) throw new Error(language === 'hu' ? 'A Brave Search API-kulcs nincs beállítva.' : 'The Brave Search API key is not configured.')
        results = await this.searchBrave(normalizedQuery, braveApiKey.trim(), language)
      }
      console.info('[web-search] completed', { provider: settings.provider, resultCount: results.length, durationMs: Date.now() - startedAt })
      return results
    } catch (error) {
      console.error('[web-search] failed', { provider: settings.provider, durationMs: Date.now() - startedAt, error: errorMessage(error) })
      throw error
    }
  }

  dispose(): void {
    for (const window of this.activeWindows) {
      if (!window.isDestroyed()) window.destroy()
    }
    this.activeWindows.clear()
  }

  private async searchBrowser(query: string, language: AppLanguage): Promise<WebSearchResult[]> {
    const searchWindow = new BrowserWindow({
      width: 1024,
      height: 760,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'loclm-web-search',
        sandbox: true,
        spellcheck: false
      }
    })
    this.activeWindows.add(searchWindow)
    searchWindow.on('closed', () => this.activeWindows.delete(searchWindow))
    searchWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    searchWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    const failures: string[] = []
    try {
      for (const url of browserSearchUrls(query, language)) {
        try {
          await loadUrlWithTimeout(searchWindow, url)
          const rawResults = await searchWindow.webContents.executeJavaScript(BROWSER_RESULT_SCRIPT, true) as RawBrowserResult[]
          const results = sanitizeResults(rawResults)
          if (results.length) return results
          failures.push(`${new URL(url).hostname}: no results`)
        } catch (error) {
          const host = safeHostname(url)
          failures.push(`${host}: ${errorMessage(error)}`)
          console.warn('[web-search] browser engine failed', { engine: host, error: errorMessage(error) })
        }
      }
    } finally {
      if (!searchWindow.isDestroyed()) searchWindow.destroy()
    }

    console.warn('[web-search] browser engines exhausted', { failures })
    throw new Error(language === 'hu'
      ? 'A beépített böngészős keresés nem adott találatot. Ellenőrizd az internetkapcsolatot, majd próbáld újra.'
      : 'The built-in browser search returned no results. Check your internet connection and try again.')
  }

  private async searchBrave(query: string, apiKey: string, language: AppLanguage): Promise<WebSearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', '8')
    url.searchParams.set('safesearch', 'moderate')
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'Accept-Language': acceptLanguage(language), 'X-Subscription-Token': apiKey },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(language === 'hu' ? `A Brave Search nem elérhető (${response.status}).` : `Brave Search is unavailable (${response.status}).`)
    const payload = await response.json() as { web?: { results?: Array<{ title: string; url: string; description?: string }> } }
    return sanitizeResults((payload.web?.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      description: result.description ?? ''
    })))
  }

  private async searchSearxng(query: string, baseUrl: string, language: AppLanguage): Promise<WebSearchResult[]> {
    const url = searxngSearchUrl(baseUrl, language)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('categories', 'general')
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'Accept-Language': acceptLanguage(language) },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(language === 'hu' ? `A SearXNG nem elérhető (${response.status}).` : `SearXNG is unavailable (${response.status}).`)
    let payload: { results?: Array<{ title: string; url: string; content?: string }> }
    try {
      payload = await response.json() as typeof payload
    } catch {
      throw new Error(language === 'hu' ? 'A SearXNG nem JSON választ adott. Engedélyezd a JSON formátumot a példányon.' : 'SearXNG did not return JSON. Enable the JSON format on the instance.')
    }
    return sanitizeResults((payload.results ?? []).slice(0, 8).map((result) => ({
      title: result.title,
      url: result.url,
      description: result.content ?? ''
    })))
  }
}

function browserSearchUrls(query: string, language: AppLanguage): string[] {
  const testTemplate = process.env.LOCLM_BROWSER_SEARCH_URL_TEMPLATE?.trim()
  if (testTemplate) {
    return [testTemplate
      .replaceAll('{query}', encodeURIComponent(query))
      .replaceAll('{language}', encodeURIComponent(language))]
  }

  const duckDuckGo = new URL('https://html.duckduckgo.com/html/')
  duckDuckGo.searchParams.set('q', query)
  duckDuckGo.searchParams.set('kl', language === 'hu' ? 'hu-hu' : 'us-en')
  const bing = new URL('https://www.bing.com/search')
  bing.searchParams.set('q', query)
  bing.searchParams.set('setlang', language === 'hu' ? 'hu-HU' : 'en-US')
  return [duckDuckGo.href, bing.href]
}

async function loadUrlWithTimeout(window: BrowserWindow, url: string): Promise<void> {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      window.loadURL(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Search page timed out.')), SEARCH_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function searxngSearchUrl(baseUrl: string, language: AppLanguage): URL {
  let base: URL
  try {
    base = new URL(baseUrl.trim())
  } catch {
    throw new Error(language === 'hu' ? 'Érvénytelen SearXNG URL.' : 'Invalid SearXNG URL.')
  }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error(language === 'hu' ? 'A SearXNG URL-nek HTTP(S) címet kell tartalmaznia.' : 'The SearXNG URL must use HTTP(S).')
  if (base.pathname.replace(/\/+$/, '').endsWith('/search')) return base
  const normalized = new URL(base.toString())
  if (!normalized.pathname.endsWith('/')) normalized.pathname += '/'
  return new URL('search', normalized)
}

function sanitizeResults(results: RawBrowserResult[]): WebSearchResult[] {
  const seen = new Set<string>()
  return results.flatMap((result) => {
    try {
      const url = unwrapSearchRedirect(new URL(result.url))
      if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) return []
      seen.add(url.href)
      return [{ title: stripMarkup(result.title).trim() || url.hostname, url: url.href, description: stripMarkup(result.description).trim() }]
    } catch {
      return []
    }
  }).slice(0, 8)
}

function unwrapSearchRedirect(url: URL): URL {
  if (url.hostname.endsWith('duckduckgo.com') && url.pathname === '/l/') {
    const target = url.searchParams.get('uddg')
    if (target) return new URL(target)
  }
  return url
}

function acceptLanguage(language: AppLanguage): string {
  return language === 'hu' ? 'hu-HU,hu;q=0.9,en;q=0.7' : 'en-US,en;q=0.9'
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ')
}
