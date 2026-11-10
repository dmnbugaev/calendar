---
name: postgres-drizzle
description: Работа с PostgreSQL, Supabase и Drizzle ORM в UniCalendar. Используй при проектировании схемы БД, миграциях drizzle-kit, запросах, транзакциях, connection pooling и подготовке к Vercel serverless.
---

# PostgreSQL, Supabase и Drizzle ORM

UniCalendar хранит данные (пользователи, Google-токены, журнал синхронизаций) в PostgreSQL на Supabase через **Drizzle ORM**.

## Схема и миграции

- Схема — в TypeScript через `drizzle-orm/pg-core` (`pgTable`, типы колонок, `pgEnum` для перечислений).
- Изменения схемы — только через **миграции** (`drizzle-kit generate` → SQL-файлы в репозитории → `drizzle-kit migrate`). Никаких ручных правок боевой БД «руками в UI» без последующей миграции.
- У каждой таблицы — понятные имена (snake_case), `created_at`/`updated_at` с `timestamp with time zone`.
- **Индексы**: внешние ключи и поля, по которым идут выборки (например, ключ синхронизации, пользователь), индексируй.
- **Уникальные ограничения** там, где дубли недопустимы (например, ключ события расписания) — на уровне БД, а не только кода.
- Не храни то, что можно вычислить; храни то, что нужно для аудита (журнал синхронизаций).

## Запросы и безопасность

- Только параметризованные запросы через Drizzle. Конкатенация SQL-строк с данными пользователя запрещена.
- Сырой SQL (`sql`) — только при необходимости, с параметрами, никогда с интерполяцией пользовательских значений.
- **Транзакции** для многошаговых операций (например, сохранить токены + журнал одной атомарной операцией).
- Персональные данные (email, Google ID, токены) храни минимизированно; токены — не в открытом виде в логах; при возможности шифруй refresh token на стороне приложения.

## Connection pooling и Vercel

- Vercel — serverless: много короткоживущих функций. Прямые соединения к Postgres от каждой функции исчерпывают лимит.
- Используй **Supabase connection pooler** (pgBouncer, transaction mode, порт `6543`) для serverless-подключений: строка вида `postgresql://...pooler.supabase.com:6543/postgres`.
- Для Drizzle + pgBouncer transaction mode отключай prepared statements (`prepare: false` в драйвере `postgres`/`pg`) — иначе возникают ошибки PreparedTransactionConflict.
- Прямой порт `5432` используй только для миграций (drizzle-kit), не для рантайма на Vercel.
- `DATABASE_URL` и все ключи — только через environment variables; в коде никаких значений по умолчанию с реальными данными.

## Проверка

- Перед коммитом миграции проверяй её на локальной/тестовой БД.
- Схема и фактические запросы проверяются тестами (Vitest) на тестовой БД, а не «на глаз».
- Актуальный синтаксис Drizzle/Supabase проверяй через **Context7 MCP** (`/drizzle-team/drizzle-orm`, `/supabase/supabase`).
