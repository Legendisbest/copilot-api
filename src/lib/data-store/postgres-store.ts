import { randomUUID } from "node:crypto"
import postgres, { type Sql } from "postgres"

import { normalizeNewStoredAccount, normalizeStoredAccount } from "./shared"
import type {
  DataStore,
  NewStoredAccount,
  RequestLogRecord,
  StoredAccount,
  StoredAccountPatch,
} from "./types"

const ACCOUNT_SELECT_COLUMNS = `
  id,
  label,
  github_token AS "githubToken",
  copilot_token AS "copilotToken",
  copilot_token_expires_at AS "copilotTokenExpiresAt",
  account_type AS "accountType",
  github_username AS "githubUsername",
  status,
  status_message AS "statusMessage",
  status_updated_at AS "statusUpdatedAt",
  is_premium AS "isPremium",
  total_requests AS "totalRequests",
  last_used_at AS "lastUsedAt",
  max_requests_per_hour AS "maxRequestsPerHour",
  max_requests_per_day AS "maxRequestsPerDay",
  rotation_weight AS "rotationWeight",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

const ACCOUNT_PATCH_TO_COLUMN: Record<
  keyof Omit<StoredAccountPatch, "totalRequestsIncrement" | "updatedAt">,
  string
> = {
  label: "label",
  githubToken: "github_token",
  copilotToken: "copilot_token",
  copilotTokenExpiresAt: "copilot_token_expires_at",
  accountType: "account_type",
  githubUsername: "github_username",
  status: "status",
  statusMessage: "status_message",
  statusUpdatedAt: "status_updated_at",
  isPremium: "is_premium",
  totalRequests: "total_requests",
  lastUsedAt: "last_used_at",
  maxRequestsPerHour: "max_requests_per_hour",
  maxRequestsPerDay: "max_requests_per_day",
  rotationWeight: "rotation_weight",
}

export class PostgresDataStore implements DataStore {
  kind = "postgres" as const

  private readonly databaseUrl: string
  private readonly sql: Sql

  constructor(databaseUrl: string) {
    this.databaseUrl = databaseUrl
    this.sql = postgres(this.databaseUrl)
  }

  async initialize(): Promise<void> {
    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        label TEXT NULL,
        github_token TEXT NOT NULL,
        copilot_token TEXT NULL,
        copilot_token_expires_at TIMESTAMP NULL,
        account_type TEXT NOT NULL DEFAULT 'individual',
        github_username TEXT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        status_message TEXT NULL,
        status_updated_at TIMESTAMP NULL,
        is_premium BOOLEAN NOT NULL DEFAULT FALSE,
        total_requests INTEGER NOT NULL DEFAULT 0,
        last_used_at TIMESTAMP NULL,
        max_requests_per_hour INTEGER NULL,
        max_requests_per_day INTEGER NULL,
        rotation_weight INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `)

    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        account_id TEXT NULL,
        endpoint TEXT NOT NULL,
        model TEXT NULL,
        status_code INTEGER NOT NULL,
        error_type TEXT NULL,
        requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
        duration_ms INTEGER NOT NULL DEFAULT 0
      );
    `)

    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `)

    await this.sql.unsafe(`
      ALTER TABLE accounts
        ADD COLUMN IF NOT EXISTS max_requests_per_hour INTEGER NULL,
        ADD COLUMN IF NOT EXISTS max_requests_per_day INTEGER NULL,
        ADD COLUMN IF NOT EXISTS rotation_weight INTEGER NOT NULL DEFAULT 1;
    `)
  }

  async listAccounts(): Promise<Array<StoredAccount>> {
    const rows = (await this.sql.unsafe(
      `SELECT ${ACCOUNT_SELECT_COLUMNS} FROM accounts ORDER BY created_at ASC`,
    )) as unknown as Array<Record<string, unknown>>
    return rows.map((row) =>
      normalizeStoredAccount(row as Record<string, unknown> & { id: unknown }),
    )
  }

  async createAccount(input: NewStoredAccount): Promise<StoredAccount> {
    const normalized = normalizeNewStoredAccount(input)
    const rows = (await this.sql.unsafe(
      `
        INSERT INTO accounts (
          id,
          label,
          github_token,
          account_type,
          github_username,
          status,
          is_premium,
          max_requests_per_hour,
          max_requests_per_day,
          rotation_weight
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING ${ACCOUNT_SELECT_COLUMNS}
      `,
      [
        randomUUID(),
        normalized.label,
        normalized.githubToken,
        normalized.accountType,
        normalized.githubUsername,
        normalized.status ?? "active",
        normalized.isPremium ?? false,
        normalized.maxRequestsPerHour ?? null,
        normalized.maxRequestsPerDay ?? null,
        normalized.rotationWeight ?? 1,
      ],
    )) as unknown as Array<Record<string, unknown>>

    const row = rows[0]
    if (!row) {
      throw new Error("Failed to create account")
    }

    return normalizeStoredAccount(row as Record<string, unknown> & { id: unknown })
  }

  async updateAccount(id: string, patch: StoredAccountPatch): Promise<void> {
    type SqlParam = string | number | boolean | Date | null

    const assignments = new Array<string>()
    const values = new Array<SqlParam>()
    let paramIndex = 2

    for (const [key, column] of Object.entries(ACCOUNT_PATCH_TO_COLUMN) as Array<
      [keyof typeof ACCOUNT_PATCH_TO_COLUMN, string]
    >) {
      const value = patch[key]
      if (value === undefined) {
        continue
      }
      assignments.push(`${column} = $${paramIndex}`)
      values.push(value as SqlParam)
      paramIndex += 1
    }

    if (patch.totalRequestsIncrement !== undefined) {
      assignments.push(
        `total_requests = COALESCE(total_requests, 0) + $${paramIndex}`,
      )
      values.push(patch.totalRequestsIncrement)
      paramIndex += 1
    }

    const updatedAt = patch.updatedAt ?? new Date()
    assignments.push(`updated_at = $${paramIndex}`)
    values.push(updatedAt)

    if (assignments.length === 0) {
      return
    }

    await this.sql.unsafe(
      `UPDATE accounts SET ${assignments.join(", ")} WHERE id = $1`,
      [id as SqlParam, ...values],
    )
  }

  async deleteAccount(id: string): Promise<void> {
    await this.sql.unsafe(`DELETE FROM accounts WHERE id = $1`, [id])
    await this.sql.unsafe(`DELETE FROM request_logs WHERE account_id = $1`, [id])
  }

  async insertRequestLog(log: RequestLogRecord): Promise<void> {
    await this.sql.unsafe(
      `
        INSERT INTO request_logs (
          id,
          account_id,
          endpoint,
          model,
          status_code,
          error_type,
          duration_ms
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        randomUUID(),
        log.accountId,
        log.endpoint,
        log.model,
        log.statusCode,
        log.errorType,
        log.durationMs,
      ],
    )
  }

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = (await this.sql.unsafe(
      `SELECT key, value FROM settings ORDER BY key ASC`,
    )) as unknown as Array<{ key: string; value: string }>
    const result: Record<string, unknown> = {}

    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value)
      } catch {
        result[row.key] = row.value
      }
    }

    return result
  }

  async upsertSettings(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value)
      await this.sql.unsafe(
        `
          INSERT INTO settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW()
        `,
        [key, serialized],
      )
    }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 })
  }
}
