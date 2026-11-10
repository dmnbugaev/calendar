# Инструкция: деплой UniCalendar на Vercel

Цель: развернуть Nuxt-приложение, настроить env-переменные и домен `calendar.dmbugaev.ru`.

## 0. Предпосылки

- Репозиторий с приложением (GitHub).
- Google OAuth-клиент готов (docs/google-cloud-console.md).
- Проект Supabase готов, миграции применены (docs/supabase.md).

## 1. Импорт проекта

1. [vercel.com](https://vercel.com) → **Add New → Project** → импортируйте репозиторий.
2. Framework Preset определится как **Nuxt** автоматически; Build Command
   (`nuxt build`), Output (`.output`) — по умолчанию. Nitro сам подставит preset
   `vercel` на платформе — ничего дополнительно настраивать не нужно.
3. Node.js Version: 20.x или 22.x.

## 2. Environment Variables (Production)

**Settings → Environment Variables** (для Production; для Preview/Development —
отдельные значения, localhost-redirect в production не попадает):

| Ключ | Значение |
|---|---|
| `DATABASE_URL` | Pooled-строка Supabase, порт **6543** (см. docs/supabase.md) |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` | Client ID |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | Client Secret |
| `NUXT_OWNER_EMAIL` | Ваш email |
| `NUXT_SESSION_SECRET` | `openssl rand -base64 32` |
| `NUXT_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (другой от session) |
| `CRON_SECRET` | `openssl rand -base64 24` — токен ежедневной автосверки; Vercel сам подставит его в `Authorization: Bearer` при вызове `/api/cron/sync` |
| `NUXT_OAUTH_GOOGLE_REDIRECT_URI` | `https://calendar.dmbugaev.ru/api/auth/google/callback` (после привязки домена) |

`DATABASE_URL_DIRECT` на Vercel НЕ нужен — миграции запускаются не из serverless.

## 3. Первый деплой

Deploy → дождаться сборки → проверить временный домен `*.vercel.app`:
- главная открывается, предпросмотр расписания загружается;
- `/api/status` → `{"connected":false,...}`.

## 4. Домен calendar.dmbugaev.ru

1. **Settings → Domains → Add** → `calendar.dmbugaev.ru`.
2. Vercel покажет DNS-запись (обычно CNAME `cname.vercel-dns.com` или A 76.76.21.21).
3. Настроить DNS у регистратора домена dmbugaev.ru **вручную** (Vercel/агент DNS не меняет).
4. Дождаться проверки (HTTPS-сертификат выдаётся автоматически).
5. Добавить `https://calendar.dmbugaev.ru` в Google Cloud Console
   (JavaScript origins + redirect URI) и переменную `NUXT_OAUTH_GOOGLE_REDIRECT_URI`
   (см. таблицу выше) → **Redeploy**.

## 5. Проверка production

- `https://calendar.dmbugaev.ru` открывается без ошибок сертификата.
- Расписание на месяц отображается (физподготовка, «Проектная деятельность» и
  Webinar-занятия не показываются — правила в `server/services/schedule/filters.ts`).
- «Подключить Google Calendar» → согласие → тост успеха, статус «Google подключён».
- «Синхронизировать» → отчёт (создано/обновлено/удалено) → события в календаре
  «Московский Политех | 251-362».
- Повторный запуск без изменений: «без изменений N», дубликаты не создаются.
- Ежедневная автосверка: Vercel → проект → **Cron Jobs** показывает `/api/cron/sync`
  (`0 3 * * *` = 06:00 МСК); в журнале запуска видно результат.
- В DevTools: нет ошибок JS/hydration, сетевые запросы без 4xx/5xx.

## Ограничения serverless (учтены в архитектуре)

- Функции без состояния: кэш access token в памяти не переживёт холодный старт —
  токены кэшируются в БД (зашифрованные) и обновляются при необходимости.
- Синхронизация — одна кнопка, ограничена по времени выполнения функции; при большом
  числе операций повторный запуск продолжит с того места (идемпотентность по ключам
  занятий).
- Vercel Cron (`vercel.json`, `/api/cron/sync`, 06:00 МСК) выполняет ежедневную сверку;
  на Hobby-плане cron ограничен запуском раз в сутки — совпадает с требованиями.
