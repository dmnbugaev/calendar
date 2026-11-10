import type { GoogleConnectionRow } from '../../db/schema'
import { decryptSecret, encryptSecret } from '../crypto'
import type { GoogleOAuthService } from '../google/oauth';
import { OAuthError } from '../google/oauth'
import type { SyncRepository } from './repository'

/**
 * GoogleTokenManager — доступ к access token с прозрачным обновлением:
 * сначала кэш в памяти, затем кэш в БД, затем refresh token.
 * refresh token хранится только в БД в зашифрованном виде.
 */

export class TokenRevokedError extends Error {
  constructor(message = 'Google-токен отозван или недействителен') {
    super(message)
    this.name = 'TokenRevokedError'
  }
}

/** Порог обновления: обновляем за 2 минуты до истечения. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000

export interface GoogleTokenProvider {
  getToken(): Promise<string>
  /** Вызывается после 401 от Google — должен вернуть заведомо свежий токен. */
  refresh(): Promise<string>
}

export class GoogleTokenManager implements GoogleTokenProvider {
  private memoryToken: { value: string; expiresAt: number } | null = null

  constructor(
    private readonly repository: SyncRepository,
    private readonly oauth: GoogleOAuthService,
    private readonly connection: GoogleConnectionRow,
    private readonly encryptionKey: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getToken(): Promise<string> {
    const cached = this.validMemoryToken()
    if (cached) return cached

    const storedExpires = this.connection.accessTokenExpiresAt?.getTime() ?? 0
    if (this.connection.encryptedAccessToken && storedExpires > this.now().getTime() + EXPIRY_MARGIN_MS) {
      const value = decryptSecret(this.connection.encryptedAccessToken, this.encryptionKey)
      this.memoryToken = { value, expiresAt: storedExpires }
      return value
    }

    return this.forceRefresh()
  }

  async refresh(): Promise<string> {
    this.memoryToken = null
    return this.forceRefresh()
  }

  private async forceRefresh(): Promise<string> {
    const refreshToken = decryptSecret(this.connection.encryptedRefreshToken, this.encryptionKey)
    let response
    try {
      response = await this.oauth.refreshAccessToken(refreshToken)
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'invalid_grant') {
        await this.repository.markConnectionRevoked(this.connection.id)
        throw new TokenRevokedError()
      }
      throw error
    }

    const expiresAt = new Date(this.now().getTime() + response.expiresIn * 1000)
    const encrypted = encryptSecret(response.accessToken, this.encryptionKey)
    // Refresh token Google выдаёт не всегда; если вернул — заменяем.
    const encryptedRefresh = response.refreshToken
      ? encryptSecret(response.refreshToken, this.encryptionKey)
      : this.connection.encryptedRefreshToken

    await this.repository.updateConnectionTokens({
      connectionId: this.connection.id,
      encryptedAccessToken: encrypted,
      accessTokenExpiresAt: expiresAt,
    })
    if (response.refreshToken) {
      // Обновляем строку подключения целиком при замене refresh token.
      await this.repository.upsertConnection({
        googleSub: this.connection.googleSub,
        email: this.connection.email,
        encryptedRefreshToken: encryptedRefresh,
        encryptedAccessToken: encrypted,
        accessTokenExpiresAt: expiresAt,
      })
    }

    this.memoryToken = { value: response.accessToken, expiresAt: expiresAt.getTime() }
    return response.accessToken
  }

  private validMemoryToken(): string | null {
    if (this.memoryToken && this.memoryToken.expiresAt > this.now().getTime() + EXPIRY_MARGIN_MS) {
      return this.memoryToken.value
    }
    return null
  }
}
