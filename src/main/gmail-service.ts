import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CredentialVault } from './vault'
import type { GmailConnectionStatus, GmailDraftInput, GmailThreadSummary } from '../shared/types'

interface GmailTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  scope?: string
  email?: string
  clientId: string
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email'
]

export class GmailService {
  constructor(private readonly vault: CredentialVault, private readonly builtInClientId = '') {}

  configuration(): { hasBuiltInClientId: boolean } {
    return { hasBuiltInClientId: Boolean(this.builtInClientId.trim()) }
  }

  status(): GmailConnectionStatus {
    const tokens = this.vault.getGmailTokens<GmailTokens>()
    return { connected: Boolean(tokens?.refreshToken || tokens?.accessToken), email: tokens?.email }
  }

  async connect(clientId = ''): Promise<GmailConnectionStatus> {
    const resolvedClientId = clientId.trim() || this.builtInClientId.trim()
    if (!resolvedClientId) throw new Error('Ehhez a LocLM buildhez nincs Google OAuth kliensazonosító beállítva. Nyisd le a haladó beállítást, és adj meg egy Desktop Client ID-t.')
    const verifier = base64Url(randomBytes(48))
    const challenge = base64Url(createHash('sha256').update(verifier).digest())
    const state = base64Url(randomBytes(24))

    const authorizationCode = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = createServer((request, response) => {
        const address = server.address() as AddressInfo
        const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`
        const requestUrl = new URL(request.url ?? '/', redirectUri)
        if (requestUrl.pathname !== '/oauth/callback') return
        const returnedState = requestUrl.searchParams.get('state')
        const code = requestUrl.searchParams.get('code')
        if (returnedState !== state || !code) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('A LocLM Gmail-hitelesítése sikertelen. Bezárhatod ezt az ablakot.')
          server.close()
          reject(new Error('A Gmail OAuth válasz érvénytelen.'))
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><meta charset="utf-8"><title>LocLM</title><style>body{font-family:system-ui;padding:48px;background:#151613;color:#f4f4ef}main{max-width:520px;margin:auto}h1{font-size:24px}</style><main><h1>Gmail csatlakoztatva</h1><p>Visszatérhetsz a LocLM alkalmazásba, ezt az ablakot bezárhatod.</p></main>')
        server.close()
        resolve({ code, redirectUri })
      })

      server.on('error', reject)
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address() as AddressInfo
        const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', resolvedClientId)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', GMAIL_SCOPES.join(' '))
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('prompt', 'consent')
        authUrl.searchParams.set('code_challenge', challenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('state', state)
        try {
          await shell.openExternal(authUrl.toString())
        } catch (error) {
          server.close()
          reject(error)
        }
      })
    })

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: resolvedClientId,
        code: authorizationCode.code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: authorizationCode.redirectUri
      })
    })
    if (!tokenResponse.ok) throw new Error(`A Gmail token lekérése sikertelen (${tokenResponse.status}).`)
    const tokenPayload = await tokenResponse.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
      scope?: string
    }
    const tokens: GmailTokens = {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      expiresAt: Date.now() + tokenPayload.expires_in * 1000,
      scope: tokenPayload.scope,
      clientId: resolvedClientId
    }
    tokens.email = await this.fetchProfileEmail(tokens.accessToken)
    await this.vault.setGmailTokens(tokens)
    return { connected: true, email: tokens.email }
  }

  async disconnect(): Promise<void> {
    const tokens = this.vault.getGmailTokens<GmailTokens>()
    if (tokens?.accessToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.accessToken)}`, { method: 'POST' }).catch(() => undefined)
    }
    await this.vault.setGmailTokens(undefined)
  }

  async search(query: string): Promise<GmailThreadSummary[]> {
    const token = await this.getAccessToken()
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/threads')
    listUrl.searchParams.set('q', query)
    listUrl.searchParams.set('maxResults', '20')
    const list = await gmailFetch<{ threads?: Array<{ id: string }> }>(listUrl, token)
    const summaries = await Promise.all((list.threads ?? []).map(async ({ id }) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}`)
      url.searchParams.set('format', 'metadata')
      for (const header of ['Subject', 'From', 'Date']) url.searchParams.append('metadataHeaders', header)
      const thread = await gmailFetch<GmailThread>(url, token)
      const first = thread.messages?.[0]
      const headers = headerMap(first?.payload?.headers)
      return {
        id,
        subject: headers.subject || '(Nincs tárgy)',
        from: headers.from || '',
        date: headers.date || '',
        snippet: thread.snippet || first?.snippet || '',
        unread: thread.messages?.some((message) => message.labelIds?.includes('UNREAD')) ?? false
      }
    }))
    return summaries
  }

  async getThreadText(threadId: string): Promise<string> {
    const token = await this.getAccessToken()
    const thread = await gmailFetch<GmailThread>(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, token)
    return (thread.messages ?? []).map((message) => {
      const headers = headerMap(message.payload?.headers)
      return `Feladó: ${headers.from || ''}\nDátum: ${headers.date || ''}\nTárgy: ${headers.subject || ''}\n\n${extractBody(message.payload)}`
    }).join('\n\n---\n\n')
  }

  async createDraft(input: GmailDraftInput): Promise<{ id: string }> {
    const token = await this.getAccessToken()
    const headers = [
      `To: ${input.to}`,
      input.cc ? `Cc: ${input.cc}` : '',
      `Subject: ${input.subject}`,
      input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : '',
      input.references ? `References: ${input.references}` : '',
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0'
    ].filter(Boolean)
    const raw = base64Url(Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf8'))
    const response = await gmailFetch<{ id: string }>('https://gmail.googleapis.com/gmail/v1/users/me/drafts', token, {
      method: 'POST',
      body: JSON.stringify({ message: { raw, threadId: input.threadId } })
    })
    return { id: response.id }
  }

  async sendDraft(draftId: string): Promise<void> {
    const token = await this.getAccessToken()
    await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', token, {
      method: 'POST',
      body: JSON.stringify({ id: draftId })
    })
  }

  async modifyThread(threadId: string, addLabelIds: string[], removeLabelIds: string[]): Promise<void> {
    const token = await this.getAccessToken()
    await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`, token, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds, removeLabelIds })
    })
  }

  private async getAccessToken(): Promise<string> {
    const tokens = this.vault.getGmailTokens<GmailTokens>()
    if (!tokens) throw new Error('A Gmail nincs csatlakoztatva.')
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken
    if (!tokens.refreshToken) throw new Error('A Gmail-kapcsolat lejárt, csatlakoztasd újra.')

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: tokens.clientId,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      })
    })
    if (!response.ok) throw new Error('A Gmail hozzáférés megújítása sikertelen.')
    const payload = await response.json() as { access_token: string; expires_in: number }
    const updated = { ...tokens, accessToken: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 }
    await this.vault.setGmailTokens(updated)
    return updated.accessToken
  }

  private async fetchProfileEmail(accessToken: string): Promise<string | undefined> {
    const profile = await gmailFetch<{ emailAddress?: string }>('https://gmail.googleapis.com/gmail/v1/users/me/profile', accessToken)
    return profile.emailAddress
  }
}

interface GmailHeader { name: string; value: string }
interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: GmailHeader[] }
interface GmailMessage { snippet?: string; labelIds?: string[]; payload?: GmailPart }
interface GmailThread { snippet?: string; messages?: GmailMessage[] }

async function gmailFetch<T = unknown>(url: string | URL, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  })
  if (!response.ok) throw new Error(`A Gmail API művelet sikertelen (${response.status}).`)
  return response.status === 204 ? undefined as T : await response.json() as T
}

function headerMap(headers: GmailHeader[] = []): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header.name.toLowerCase(), header.value]))
}

function extractBody(part?: GmailPart): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) {
    const body = extractBody(child)
    if (body) return body
  }
  if (part.body?.data) return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, ' ')
  return ''
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
