import { createHash } from 'node:crypto'

/**
 * OAuthService — Authorization Code flow для Google OAuth 2.0 (серверная
 * сторона Nitro): PKCE (S256), state, обмен кода, refresh, revoke.
 *
 * Scopes — минимально необходимые (skill google-calendar-oauth):
 *  - calendar.events — чтение/запись событий;
 *  - calendar        — управление календарями (создание календаря расписания).
 * Email владельца берётся из calendars.get('primary') (id primary-календаря
 * равен email), поэтому openid/email не запрашиваются.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const PRIMARY_CALENDAR_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary'

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
]

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  /** Можно задать здесь или передавать в методы (redirectUri из запроса). */
  redirectUri: string
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string | null
  /** Секунд до истечения access token. */
  expiresIn: number
}

export interface GoogleUserInfo {
  /** Google account id (sub). */
  sub: string
  /** Email = id primary-календаря. */
  email: string
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

function requireConfig(config: OAuthConfig): OAuthConfig {
  if (!config.clientId || !config.clientSecret) {
    throw new OAuthError('Google OAuth не настроен: проверьте NUXT_OAUTH_GOOGLE_* переменные')
  }
  return config
}

/** PKCE code_challenge из code_verifier (S256). */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function buildAuthorizeUrl(config: OAuthConfig, params: {
  state: string
  codeVerifier: string
  redirectUri: string
}): string {
  const cfg = requireConfig(config)
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri || cfg.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', CALENDAR_SCOPES.join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', codeChallenge(params.codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  // Повторный вход всегда даёт свежий refresh token.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'false')
  return url.toString()
}

/** Тело запроса к /token. */
function tokenRequestBody(cfg: OAuthConfig, fields: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams(fields)
  body.set('client_id', cfg.clientId)
  body.set('client_secret', cfg.clientSecret)
  return body
}

export class GoogleOAuthService {
  constructor(
    private readonly config: OAuthConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  authorizeUrl(params: { state: string; codeVerifier: string; redirectUri: string }): string {
    return buildAuthorizeUrl(this.config, params)
  }

  /** Обмен authorization code на токены. */
  async exchangeCode(params: {
    code: string
    codeVerifier: string
    redirectUri: string
  }): Promise<TokenResponse> {
    const cfg = requireConfig(this.config)
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequestBody(cfg, {
        code: params.code,
        code_verifier: params.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: params.redirectUri || cfg.redirectUri,
      }),
    })
    return parseTokenResponse(response)
  }

  /** Обновление access token по refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const cfg = requireConfig(this.config)
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequestBody(cfg, {
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    return parseTokenResponse(response)
  }

  /** Отзыв токена (при отключении аккаунта или чужом входе). */
  async revokeToken(token: string): Promise<void> {
    await this.fetchFn(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    }).catch(() => {
      // Revoke идемпотентен: ошибка (например, токен уже отозван) не важна.
    })
  }

  /**
   * Email и sub владельца. Без openid scope email = id primary-календаря,
   * sub не предоставляется напрямую — используем email как идентификатор
   * google_sub (для одного владельца достаточно и однозначно).
   */
  async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await this.fetchFn(PRIMARY_CALENDAR_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (response.status === 401) {
      throw new OAuthError('Google отклонил access token при запросе календаря', 'invalid_token')
    }
    if (!response.ok) {
      throw new OAuthError(
        `Не удалось получить данные аккаунта Google (HTTP ${response.status})`,
      )
    }
    const data = (await response.json()) as { id?: string; summary?: string }
    const email = data.id
    if (!email || !email.includes('@')) {
      throw new OAuthError('Google не вернул email аккаунта')
    }
    return { sub: email, email }
  }
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  let payload: Record<string, unknown>
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    throw new OAuthError(`Google /token вернул не-JSON ответ (HTTP ${response.status})`)
  }

  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : null
    // invalid_grant — код уже использован/просрочен или refresh token отозван.
    throw new OAuthError(
      `Google OAuth вернул ошибку: ${code ?? response.status}`,
      code,
    )
  }

  const accessToken = payload.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new OAuthError('Google OAuth не вернул access token')
  }
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : null
  return { accessToken, refreshToken, expiresIn }
}
