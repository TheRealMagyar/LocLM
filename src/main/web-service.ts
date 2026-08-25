import type { WebSearchResult, WebSettings } from '../shared/types'

export class WebSearchService {
  async search(query: string, settings: WebSettings, braveApiKey?: string): Promise<WebSearchResult[]> {
    if (!query.trim()) return []
    if (settings.provider === 'searxng') return this.searchSearxng(query, settings.searxngUrl)
    if (!braveApiKey) throw new Error('A Brave Search API-kulcs nincs beállítva.')
    return this.searchBrave(query, braveApiKey)
  }

  private async searchBrave(query: string, apiKey: string): Promise<WebSearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', '8')
    url.searchParams.set('safesearch', 'moderate')
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }
    })
    if (!response.ok) throw new Error(`A Brave Search nem elérhető (${response.status}).`)
    const payload = await response.json() as { web?: { results?: Array<{ title: string; url: string; description?: string }> } }
    return (payload.web?.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      description: result.description ?? ''
    }))
  }

  private async searchSearxng(query: string, baseUrl: string): Promise<WebSearchResult[]> {
    const url = new URL('/search', baseUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`A SearXNG nem elérhető (${response.status}).`)
    const payload = await response.json() as { results?: Array<{ title: string; url: string; content?: string }> }
    return (payload.results ?? []).slice(0, 8).map((result) => ({
      title: result.title,
      url: result.url,
      description: result.content ?? ''
    }))
  }
}
