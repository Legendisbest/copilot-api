import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!db) {
    throw new Error(
      "Database not initialized. Ensure DATABASE_URL is set and initDatabase() was called.",
    )
  }
  return db
}

export function isDbInitialized() {
  return db !== null
}

export function initDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl)
  db = drizzle(client, { schema })
  return db
}
