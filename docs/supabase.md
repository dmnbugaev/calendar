# Инструкция: настройка Supabase для UniCalendar

Цель: создать PostgreSQL-проект, применить миграции, получить строки подключения.

## 1. Создание проекта

1. [supabase.com](https://supabase.com/) → **New project**.
2. Имя «UniCalendar», регион — ближайший к пользователям (для РФ обычно `eu-central-1`).
3. Сохраните database password — понадобится в строках подключения.

## 2. Строки подключения

**Project Settings → Database → Connection string**:

- **Runtime (Vercel, переменная `DATABASE_URL`)** — Transaction pooler (pgBouncer, порт `6543`):

  ```
  postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
  ```

  Приложение использует драйвер `postgres` с `prepare: false` — обязательное требование
  transaction mode (иначе PreparedTransactionConflict).

- **Миграции (локальная переменная `DATABASE_URL_DIRECT`)** — Direct connection (порт `5432`):

  ```
  postgresql://postgres.<project-ref>:<password>@aws-0-<region>.supabase.com:5432/postgres
  ```

## 3. Применение миграций

Из корня проекта (DATABASE_URL_DIRECT уже в .env):

```bash
npm run db:migrate
```

Создаются: enums `google_connection_status`, `sync_run_status`; таблицы
`google_connection`, `calendar_settings`, `synced_event`, `sync_history` с индексами,
включая частичный уникальный индекс `sync_history_one_running_uq` (защита от параллельных
запусков синхронизации).

Проверка: **Supabase → Table Editor** — должны появиться 4 таблицы.

## 4. Безопасность

- Ключи `service_role`/`anon` для клиентского кода не нужны — приложение работает с БД
  только на сервере (Nitro), через прямое подключение по строке `DATABASE_URL`.
- RLS можно не включать: доступ идёт под postgres-пользователем вне PostgREST;
  PostgREST API используется приложением не вовсе.
