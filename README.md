# UniCalendar

Ручная синхронизация расписания Московского Политеха (группа **251-362**) с Google Calendar.

Production: **https://calendar.dmbugaev.ru**

## Что делает приложение

- Получает расписание группы 251-362 из официального API сайта [rasp.dmami.ru](https://rasp.dmami.ru/?g=251-362).
- Показывает предпросмотр расписания на ближайший **месяц** (без входа).
- Подключает Google-аккаунт владельца через OAuth 2.0 (Authorization Code + PKCE).
- Создаёт **отдельный календарь** «Московский Политех | 251-362» — личный календарь не изменяется.
- По кнопке «Синхронизировать» (и **ежедневной автосверке в 06:00 МСК**, см. ниже) переносит занятия в календарь:
  - окно синхронизации — **месяц вперёд** от сегодняшнего дня;
  - создаёт новые, обновляет изменённые (аудитория/преподаватель/время), удаляет отменённые;
  - **не создаёт дубликаты** (стабильный ключ занятия в `extendedProperties.private.unicalendarKey`);
  - **не удаляет ничего** при ошибке/пустоте источника; массовое удаление (>50%) требует явного подтверждения;
  - не трогает события, созданные вручную (без маркера приложения);
  - пишет журнал каждого запуска в PostgreSQL.

## Правила отбора занятий

По настройке владельца в календарь **не попадают** (`server/services/schedule/filters.ts`):

- «Общая физическая подготовка» и другие формулировки физкультуры (спортзал);
- «Проектная деятельность»;
- занятия с пометкой **Webinar** в месте проведения (онлайн).

Кроме того, занятие берётся только внутри своего периода из источника (`df`–`dt`):
курс, который ещё не начался или уже закончился, в расписание не вписывается.

## Ежедневная автосверка (Vercel Cron)

`vercel.json` содержит cron: `/api/cron/sync`, `0 3 * * *` — **06:00 Europe/Moscow**
(Moscow — фиксированный UTC+3; Vercel Cron работает в UTC). Для защиты задайте
в Vercel Environment Variables `CRON_SECRET` — Vercel отправит его в заголовке
`Authorization: Bearer CRON_SECRET`; маршрут сравнивает токен timing-safe.
Если аккаунт не подключён или выполняется ручная синхронизация — запуск
корректно пропускается. Массовое удаление по cron никогда не выполняется
автоматически — только по явному подтверждению владельца в интерфейсе.

## Технологии

Nuxt 4 · Vue 3 (`<script setup>`) · TypeScript strict · Nitro · Tailwind CSS 4 · Nuxt UI 4 ·
Drizzle ORM · PostgreSQL (Supabase) · Zod 4 · date-fns · Vitest · Playwright.

## Структура

```text
app/                        # клиент (страницы, компоненты, composables)
server/
  api/                      # Nitro-маршруты (auth, status, sync, schedule, history)
  services/
    schedule/               # provider → parser (Zod) → normalizer
    google/                 # OAuth и Calendar REST-клиент
    sync/                   # engine, repository, token-manager
    owner.ts, session.ts, crypto.ts, db.ts, factories.ts
server/db/schema.ts         # Drizzle-схема (4 таблицы)
db/migrations/              # SQL-миграции drizzle-kit
shared/                     # типы и Zod-схемы API-контрактов (клиент+сервер)
tests/unit, tests/e2e       # Vitest и Playwright
fixtures/                   # реальный ответ API + заметки исследования
docs/                       # инструкции: Google Cloud, Supabase, Vercel
```

## Быстрый старт (локально)

```bash
npm install
cp .env.example .env        # заполнить значения (см. раздел ниже)
npx drizzle-kit migrate     # применить миграции к БД (DATABASE_URL_DIRECT)
npm run dev                 # http://localhost:3000
```

### Переменные окружения

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Pooled-строка Supabase (порт **6543**, pgBouncer transaction mode) — рантайм |
| `DATABASE_URL_DIRECT` | Прямая строка (порт **5432**) — только для миграций |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` | OAuth Client ID из Google Cloud Console |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | OAuth Client Secret |
| `NUXT_OAUTH_GOOGLE_REDIRECT_URI` | Опционально; иначе вычисляется из хоста. Значения: `http://localhost:3000/api/auth/google/callback` (dev), `https://calendar.dmbugaev.ru/api/auth/google/callback` (prod) |
| `NUXT_OWNER_EMAIL` | Email владельца — только он может подключить аккаунт |
| `NUXT_SESSION_SECRET` | Ключ подписи сессии (`openssl rand -base64 32`) |
| `NUXT_TOKEN_ENCRYPTION_KEY` | Ключ AES-256-GCM для refresh token (`openssl rand -base64 32`). **Смена после подключения сбрасывает интеграцию** |
| `CRON_SECRET` | Токен маршрута ежедневной автосверки `/api/cron/sync` (Vercel подставляет его в Authorization сам) |

Scopes Google: `calendar.events` (события) + `calendar` (создание календаря). Email владельца
определяется через id primary-календаря — лишние scopes (openid/profile) не запрашиваются.

## Синхронизация: окно и правила

- Окно: **месяц вперёд** от сегодняшнего дня (Europe/Moscow, UTC+3 без перехода на
  летнее время), но не дальше конца семестра (`group.dateTo` из API). Прошедшие
  события не создаются и не удаляются.
- Время пар — из клиентского кода сайта расписания (три таблицы по `group.evening`).
- Чётность недель: в текущих данных всех групп поле `week` пустое; если появятся значения
  `odd`/`even`, они привязываются к учебным неделям от начала семестра (первая — нечётная).
  Неизвестные значения останавливают синхронизацию (см. `fixtures/RESEARCH.md`).
- Параллельные запуски блокируются частичным уникальным индексом
  `sync_history_one_running_uq` (один `running`-запуск на подключение).

## Команды

```bash
npm run dev          # dev-сервер
npm run build        # production-сборка (Nitro)
node .output/server/index.mjs  # запуск сборки
npm test             # Vitest unit-тесты (31)
npm run test:e2e     # Playwright E2E (22, нужны установленные браузеры)
npm run typecheck    # vue-tsc / Nuxt typecheck
npm run lint         # ESLint
npm run db:generate  # сгенерировать миграцию из схемы
npm run db:migrate   # применить миграции
```

## Деплой на Vercel

Пошаговые инструкции: [docs/google-cloud-console.md](docs/google-cloud-console.md) →
[docs/supabase.md](docs/supabase.md) → [docs/vercel.md](docs/vercel.md).

Кратко: создать OAuth-клиент в Google Cloud, проект Supabase, применить миграции прямой
строкой, импортировать репозиторий в Vercel, задать env-переменные (production), привязать
домен `calendar.dmbugaev.ru`. Nitro автоматически использует Vercel-preset; Vercel Cron
(`vercel.json`) выполняет автосверку ежедневно в 06:00 МСК — кнопка «Синхронизировать»
остаётся ручным способом.

## Безопасность

- Секреты только в environment variables; refresh token шифруется AES-256-GCM в БД.
- Токены никогда не покидают сервер (нет в cookies/клиентском коде/логах).
- OAuth: `state` (одноразовая httpOnly cookie), PKCE S256, `prompt=consent` для повторного
  получения refresh token; посторонние аккаунты отклоняются и отзываются.
- Сессия владельца — подписанная HMAC httpOnly cookie (30 дней); мутации защищены
  same-origin проверкой (CSRF).
- Затронутые таблицы БД: только данные приложения; отключение аккаунта удаляет строку
  подключения (каскад), но **не удаляет** созданный в Google календарь и события.
