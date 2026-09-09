import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { GrokConnectionStatus } from '../shared/types'
import { GROK_CHAT_BASE_URL } from '../shared/model'

const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const GROK_AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize'
const GROK_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const GROK_SCOPE = 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write'
const GROK_CALLBACK_HOST = '127.0.0.1'
const GROK_CALLBACK_PORT = 56121
const GROK_CALLBACK_PATH = '/callback'
const GROK_REDIRECT_URI = `http://${GROK_CALLBACK_HOST}:${GROK_CALLBACK_PORT}${GROK_CALLBACK_PATH}`
const GROK_CLIENT_VERSION = '1.0.13'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const REFRESH_SKEW_MS = 2 * 60 * 1000

interface GrokAuthEntry {
  key: string
  auth_mode?: string
  create_time?: string
  expires_at?: string
  refresh_token?: string
  oidc_issuer?: string
  oidc_client_id?: string
  email?: string
  user_id?: string
  team_id?: string
  first_name?: string
  last_name?: string
  principal_type?: string
  principal_id?: string
}

type GrokAuthFile = Record<string, GrokAuthEntry>

interface TokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

interface JwtClaims {
  sub?: string
  exp?: number
  team_id?: string
  principal_type?: string
  principal_id?: string
}

export class GrokService {
  readonly baseUrl = GROK_CHAT_BASE_URL

  status(): GrokConnectionStatus {
    const entry = this.readEntry()
    if (!entry?.key) return { connected: false }
    return { connected: true, email: entry.email }
  }

  identityHeaders(): Record<string, string> {
    return {
      'x-xai-token-auth': 'xai-grok-cli',
      'x-grok-client-identifier': 'grok-shell',
      'x-grok-client-version': GROK_CLIENT_VERSION
    }
  }

  async connect(): Promise<GrokConnectionStatus> {
    const existing = this.readEntry()
    if (existing?.key && existing.refresh_token && !isExpired(existing, REFRESH_SKEW_MS)) {
      return { connected: true, email: existing.email }
    }
    if (existing?.refresh_token) {
      try {
        return this.statusAfter(await this.refresh(existing))
      } catch {
        // A full browser login replaces a session that can no longer be refreshed.
      }
    }

    const verifier = base64Url(randomBytes(48))
    const challenge = base64Url(createHash('sha256').update(verifier).digest())
    const state = base64Url(randomBytes(24))
    const nonce = base64Url(randomBytes(24))
    const authorizationCode = await waitForAuthorizationCode({ challenge, state, nonce })
    const tokenResponse = await fetch(GROK_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GROK_CLIENT_ID,
        code: authorizationCode,
        redirect_uri: GROK_REDIRECT_URI,
        code_verifier: verifier
      })
    })
    if (!tokenResponse.ok) throw new Error(await tokenError(tokenResponse, 'A Grok belépés sikertelen.'))
    const tokens = await tokenResponse.json() as TokenPayload
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('A Grok belépés nem adott vissza érvényes tokent.')
    return this.statusAfter(await this.persistTokens(tokens, existing))
  }

  async disconnect(): Promise<void> {
    const file = await this.readFile()
    const key = this.preferredKey(file)
    if (!key) return
    delete file[key]
    await this.writeFile(file)
  }

  async getAccessToken(): Promise<string> {
    const entry = this.readEntry()
    if (!entry?.key) throw new Error('A Grok nincs csatlakoztatva. Jelentkezz be a Beállításokban a Grok előfizetéseddel.')
    if (!isExpired(entry, REFRESH_SKEW_MS)) return entry.key
    if (!entry.refresh_token) throw new Error('A Grok-kapcsolat lejárt, jelentkezz be újra.')
    return (await this.refresh(entry)).key
  }

  private async refresh(entry: GrokAuthEntry): Promise<GrokAuthEntry> {
    const response = await fetch(GROK_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: GROK_CLIENT_ID,
        refresh_token: entry.refresh_token ?? ''
      })
    })
    if (!response.ok) throw new Error(await tokenError(response, 'A Grok hozzáférés megújítása sikertelen. Jelentkezz be újra.'))
    const tokens = await response.json() as TokenPayload
    if (!tokens.access_token) throw new Error('A Grok token megújítása érvénytelen választ adott.')
    return this.persistTokens(tokens, entry)
  }

  private async persistTokens(tokens: TokenPayload, previous?: GrokAuthEntry): Promise<GrokAuthEntry> {
    const claims = decodeJwt(tokens.access_token ?? '')
    const now = new Date()
    const entry: GrokAuthEntry = {
      ...previous,
      key: tokens.access_token ?? '',
      auth_mode: 'oidc',
      create_time: previous?.create_time ?? now.toISOString(),
      expires_at: expiryDate(tokens.expires_in, claims?.exp, now).toISOString(),
      refresh_token: tokens.refresh_token ?? previous?.refresh_token,
      oidc_issuer: 'https://auth.x.ai',
      oidc_client_id: GROK_CLIENT_ID,
      user_id: claims?.sub ?? previous?.user_id,
      team_id: claims?.team_id ?? previous?.team_id,
      principal_type: claims?.principal_type ?? previous?.principal_type,
      principal_id: claims?.principal_id ?? claims?.sub ?? previous?.principal_id
    }
    if (!entry.email) entry.email = await fetchEmail(entry.key) ?? previous?.email
    const file = await this.readFile()
    file[this.scopeKey()] = entry
    await this.writeFile(file)
    return entry
  }

  private statusAfter(entry: GrokAuthEntry): GrokConnectionStatus {
    return { connected: Boolean(entry.key), email: entry.email }
  }

  private authPath(): string {
    return join(process.env.GROK_HOME?.trim() || join(homedir(), '.grok'), 'auth.json')
  }

  private scopeKey(): string {
    return `https://auth.x.ai::${GROK_CLIENT_ID}`
  }

  private preferredKey(file: GrokAuthFile): string | undefined {
    if (file[this.scopeKey()]?.key) return this.scopeKey()
    return Object.keys(file).find((key) => key.startsWith('https://auth.x.ai::') && file[key]?.key)
  }

  private readEntry(): GrokAuthEntry | undefined {
    const file = this.readFileSync()
    const key = this.preferredKey(file)
    return key ? file[key] : undefined
  }

  private readFileSync(): GrokAuthFile {
    try {
      const parsed = JSON.parse(readFileSync(this.authPath(), 'utf8')) as unknown
      return isAuthFile(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private async readFile(): Promise<GrokAuthFile> {
    try {
      const parsed = JSON.parse(await readFile(this.authPath(), 'utf8')) as unknown
      return isAuthFile(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private async writeFile(file: GrokAuthFile): Promise<void> {
    const path = this.authPath()
    await mkdir(dirname(path), { recursive: true })
    const payload = `${JSON.stringify(file, null, 2)}\n`
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, payload, 'utf8')
    try {
      await rename(temporary, path)
    } catch {
      await writeFile(path, payload, 'utf8')
      await unlink(temporary).catch(() => undefined)
    }
  }
}

function waitForAuthorizationCode(params: { challenge: string; state: string; nonce: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', GROK_REDIRECT_URI)
      if (requestUrl.pathname !== GROK_CALLBACK_PATH) return
      const returnedState = requestUrl.searchParams.get('state')
      const code = requestUrl.searchParams.get('code')
      const error = requestUrl.searchParams.get('error')
      if (error || returnedState !== params.state || !code) {
        const detail = requestUrl.searchParams.get('error_description') || error || 'invalid response'
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(callbackPage('Grok belépés sikertelen', 'A LocLM nem tudta befejezni a Grok belépést. Bezárhatod ezt az ablakot.'))
        finish(() => reject(new Error(`A Grok OAuth válasz érvénytelen (${detail}).`)))
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(callbackPage('Grok csatlakoztatva', 'Visszatérhetsz a LocLM alkalmazásba, ezt az ablakot bezárhatod.'))
      finish(() => resolve(code))
    })

    const timer = setTimeout(() => {
      finish(() => reject(new Error('A Grok belépés túllépte az időkorlátot.')))
    }, LOGIN_TIMEOUT_MS)

    let settled = false
    const finish = (next: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      next()
    }

    server.on('error', (error) => {
      finish(() => {
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          reject(new Error('A Grok belépéshez szükséges 56121-es port foglalt. Zárd be a másik Grok belépési ablakot, majd próbáld újra.'))
          return
        }
        reject(error)
      })
    })

    server.listen(GROK_CALLBACK_PORT, GROK_CALLBACK_HOST, async () => {
      const authUrl = new URL(GROK_AUTHORIZE_URL)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', GROK_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', GROK_REDIRECT_URI)
      authUrl.searchParams.set('scope', GROK_SCOPE)
      authUrl.searchParams.set('code_challenge', params.challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', params.state)
      authUrl.searchParams.set('nonce', params.nonce)
      authUrl.searchParams.set('referrer', 'grok-build')
      try {
        await shell.openExternal(authUrl.toString())
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error('A Grok belépőoldal nem nyílt meg.')))
      }
    })
  })
}

function callbackPage(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>LocLM</title><style>body{font-family:system-ui;padding:48px;background:#151613;color:#f4f4ef}main{max-width:520px;margin:auto}h1{font-size:24px}</style><main><h1>${title}</h1><p>${body}</p></main>`
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch('https://auth.x.ai/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    })
    if (!response.ok) return undefined
    const payload = await response.json() as { email?: string }
    return payload.email
  } catch {
    return undefined
  }
}

async function tokenError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: string; error_description?: string }
    return payload.error_description ?? payload.error ?? `${fallback} (${response.status})`
  } catch {
    return `${fallback} (${response.status})`
  }
}

function isExpired(entry: GrokAuthEntry, skewMs: number): boolean {
  const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : jwtExpiry(entry.key)
  if (!Number.isFinite(expiresAt)) return false
  return expiresAt - skewMs <= Date.now()
}

function jwtExpiry(token: string): number {
  const exp = decodeJwt(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : Number.NaN
}

function expiryDate(expiresIn: number | undefined, jwtExp: number | undefined, now: Date): Date {
  if (typeof expiresIn === 'number' && expiresIn > 0) return new Date(now.getTime() + expiresIn * 1000)
  if (typeof jwtExp === 'number') return new Date(jwtExp * 1000)
  return new Date(now.getTime() + 6 * 60 * 60 * 1000)
}

function decodeJwt(token: string): JwtClaims | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as JwtClaims
  } catch {
    return undefined
  }
}

function isAuthFile(value: unknown): value is GrokAuthFile {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
