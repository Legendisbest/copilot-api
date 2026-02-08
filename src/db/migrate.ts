import { migrate } from "drizzle-orm/postgres-js/migrator"
import path from "node:path"

import { getDb } from "./connection"

export async function runMigrations() {
  const db = getDb()
  const migrationsFolder = path.resolve(
    import.meta.dirname ?? ".",
    "../../drizzle",
  )
  await migrate(db, { migrationsFolder })
}
