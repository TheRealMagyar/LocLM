import { app, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SecretSettings } from '../shared/types'

type StoredSecrets = Record<keyof SecretSettings | 'gmailTokens', string>

export class CredentialVault {
  private readonly filePath = join(app.getPath('userData'), 'loclm-secrets.json')
  private stored: Partial<StoredSecrets> = {}

  async initialize(): Promise<void> {
    try {
      this.stored = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<StoredSecrets>
    } catch {
      this.stored = {}
    }
  }

  getSecrets(): SecretSettings {
    return {
      modelApiKey: this.readSecret('modelApiKey'),
      braveApiKey: this.readSecret('braveApiKey')
    }
  }

  async setSecrets(values: SecretSettings): Promise<void> {
    for (const [key, value] of Object.entries(values) as Array<[keyof SecretSettings, string | undefined]>) {
      if (value) this.stored[key] = this.encrypt(value)
      else delete this.stored[key]
    }
    await this.persist()
  }

  getGmailTokens<T>(): T | undefined {
    const raw = this.readSecret('gmailTokens')
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }

  async setGmailTokens(value?: unknown): Promise<void> {
    if (value) this.stored.gmailTokens = this.encrypt(JSON.stringify(value))
    else delete this.stored.gmailTokens
    await this.persist()
  }

  private readSecret(key: keyof StoredSecrets): string | undefined {
    const encrypted = this.stored[key]
    if (!encrypted) return undefined
    try {
      if (encrypted.startsWith('safe:') && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(encrypted.slice(5), 'base64'))
      }
      if (encrypted.startsWith('local:')) return Buffer.from(encrypted.slice(6), 'base64').toString('utf8')
    } catch {
      return undefined
    }
    return undefined
  }

  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(value).toString('base64')}`
    }
    return `local:${Buffer.from(value, 'utf8').toString('base64')}`
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.stored, null, 2), 'utf8')
  }
}
