import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

/**
 * Drizzle-клиент. На Vercel (serverless) соединение идёт через
 * Supabase pooler (pgBouncer, transaction mode) — поэтому prepare: false
 * обязательно (см. skill postgres-drizzle).
 */

let cached: PostgresJsDatabase<typeof schema> | null = null

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (cached) return cached
  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    throw new Error(
      'DATABASE_URL не задан — подключение к PostgreSQL невозможно (см. .env.example)',
    )
  }
  const client = postgres(url, {
    // Требование pgBouncer transaction mode: без prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  cached = drizzle(client, { schema })
  return cached
}

export { schema }
