import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'
import { getDb } from './db'
import { GoogleOAuthService } from './google/oauth'
import { SessionService } from './session'
import { SyncRepository } from './sync/repository'
import { UniversityScheduleProvider } from './schedule/provider'

/**
 * Сборка сервисов из runtimeConfig. Сервисы, зависящие от секретов,
 * равны null, если конфигурация не задана — маршруты возвращают
 * внятную ошибку 503 вместо падения.
 */

export interface AppServices {
  session: SessionService | null
  repository: SyncRepository | null
  oauth: GoogleOAuthService | null
  oauthConfigured: boolean
  encryptionKey: string | null
  ownerEmail: string
  isProduction: boolean
  scheduleProvider: UniversityScheduleProvider
}

export function buildServices(event: H3Event): AppServices {
  const config = useRuntimeConfig(event)
  const isProduction = process.env.NODE_ENV === 'production'

  let session: SessionService | null = null
  if (config.sessionSecret) {
    try {
      session = new SessionService(config.sessionSecret, isProduction)
    } catch {
      session = null
    }
  }

  let repository: SyncRepository | null = null
  try {
    repository = new SyncRepository(getDb())
  } catch {
    // DATABASE_URL не задан — маршруты вернут 503 с понятным сообщением.
  }

  const oauthConfigured
    = Boolean(config.oauth.googleClientId) && Boolean(config.oauth.googleClientSecret)
  const oauth = oauthConfigured
    ? new GoogleOAuthService({
        clientId: config.oauth.googleClientId,
        clientSecret: config.oauth.googleClientSecret,
        // redirectUri резолвится из хоста запроса в маршруте.
        redirectUri: '',
      })
    : null

  return {
    session,
    repository,
    oauth,
    oauthConfigured,
    encryptionKey: config.tokenEncryptionKey || null,
    ownerEmail: config.ownerEmail || '',
    isProduction,
    scheduleProvider: new UniversityScheduleProvider(),
  }
}
