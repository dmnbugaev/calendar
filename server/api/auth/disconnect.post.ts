import { decryptSecret } from '../../services/crypto'
import { buildServices } from '../../services/factories'
import { assertSameOrigin, requireOwner } from '../../services/owner'

/**
 * POST /api/auth/disconnect — отключение аккаунта (по кнопке владельца
 * с подтверждением в UI). Отзывает refresh token в Google и удаляет
 * строку подключения вместе со связанными данными (каскад).
 * События и сам календарь в Google остаются — пользователь управляет
 * ими вручную; приложение повторно найдёт календарь при новом подключении.
 */
export default defineEventHandler(async (event) => {
  const services = buildServices(event)
  if (!services.session || !services.repository || !services.encryptionKey || !services.oauth) {
    throw createError({ statusCode: 503, statusMessage: 'Приложение не настроено' })
  }

  assertSameOrigin(event)
  const { connectionId } = await requireOwner(
    {
      session: services.session,
      repository: services.repository,
      ownerEmail: services.ownerEmail,
      isProduction: services.isProduction,
    },
    event,
  )

  const connection = await services.repository.findConnectionBySub(
    getOwnerSub(services, event),
  )
  if (connection) {
    // Отзыв refresh token — Google больше не выпустит токены по нему.
    try {
      const refreshToken = decryptSecret(
        connection.encryptedRefreshToken,
        services.encryptionKey,
      )
      await services.oauth.revokeToken(refreshToken)
    } catch {
      // Токен уже недействителен — отключение всё равно выполняем.
    }
    await services.repository.deleteConnection(connectionId)
  }

  services.session.clearSessionCookie(event)
  return { ok: true }
})

function getOwnerSub(
  services: ReturnType<typeof buildServices>,
  event: Parameters<typeof requireOwner>[1],
): string {
  const session = services.session!
  return session.parseCookieValue(getCookie(event, 'uni_session'))?.sub ?? ''
}
