import { randomUUID } from "node:crypto"

import mysql, { type Pool } from "mysql2/promise"

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
  github_token AS githubToken,
  copilot_token AS copilotToken,
  copilot_token_expires_at AS copilotTokenExpiresAt,
  account_type AS accountType,
  github_username AS githubUsername,
  status,
  status_message AS statusMessage,
  status_updated_at AS statusUpdatedAt,
  is_premium AS isPremium,
  total_requests AS totalRequests,
  last_used_at AS lastUsedAt,
  max_requests_per_hour AS maxRequestsPerHour,
  max_requests_per_day AS maxRequestsPerDay,
  rotation_weight AS rotationWeight,
  created_at AS createdAt,
  updated_at AS updatedAt
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

export class MySqlDataStore implements DataStore {
  kind = "mysql" as const

  private readonly databaseUrl: string
  private readonly pool: Pool

  constructor(databaseUrl: string) {
    this.databaseUrl = databaseUrl
    this.pool = mysql.createPool(this.databaseUrl)
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id CHAR(36) PRIMARY KEY,
        label TEXT NULL,
        github_token TEXT NOT NULL,
        copilot_token TEXT NULL,
        copilot_token_expires_at DATETIME NULL,
        account_type VARCHAR(32) NOT NULL DEFAULT 'individual',
        github_username VARCHAR(255) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        status_message TEXT NULL,
        status_updated_at DATETIME NULL,
        is_premium BOOLEAN NOT NULL DEFAULT FALSE,
        total_requests INT NOT NULL DEFAULT 0,
        last_used_at DATETIME NULL,
        max_requests_per_hour INT NULL,
        max_requests_per_day INT NULL,
        rotation_weight INT NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id CHAR(36) PRIMARY KEY,
        account_id CHAR(36) NULL,
        endpoint TEXT NOT NULL,
        model VARCHAR(255) NULL,
        status_code INT NOT NULL,
        error_type VARCHAR(255) NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        duration_ms INT NOT NULL DEFAULT 0,
        INDEX idx_request_logs_account_id (account_id)
      )
    `)

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(191) PRIMARY KEY,
        \`value\` TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)
  }

  async listAccounts(): Promise<Array<StoredAccount>> {
    const [rows] = await this.pool.query(
      `SELECT ${ACCOUNT_SELECT_COLUMNS} FROM accounts ORDER BY created_at ASC`,
    )
    return (rows as Array<Record<string, unknown>>).map((row) =>
      normalizeStoredAccount(row as Record<string, unknown> & { id: unknown }),
    )
  }

  async createAccount(input: NewStoredAccount): Promise<StoredAccount> {
    const normalized = normalizeNewStoredAccount(input)
    const id = randomUUID()

    await this.pool.query(
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
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
    )

    const [rows] = await this.pool.query(
      `SELECT ${ACCOUNT_SELECT_COLUMNS} FROM accounts WHERE id = ? LIMIT 1`,
      [id],
    )
    const row = (rows as Array<Record<string, unknown>>)[0]
    if (!row) {
      throw new Error("Failed to create account")
    }
    return normalizeStoredAccount(row as Record<string, unknown> & { id: unknown })
  }

  async updateAccount(id: string, patch: StoredAccountPatch): Promise<void> {
    const assignments = new Array<string>()
    const values = new Array<unknown>()

    for (const [key, column] of Object.entries(ACCOUNT_PATCH_TO_COLUMN) as Array<
      [keyof typeof ACCOUNT_PATCH_TO_COLUMN, string]
    >) {
      const value = patch[key]
      if (value === undefined) {
        continue
      }
      assignments.push(`${column} = ?`)
      values.push(value)
    }

    if (patch.totalRequestsIncrement !== undefined) {
      assignments.push("total_requests = COALESCE(total_requests, 0) + ?")
      values.push(patch.totalRequestsIncrement)
    }

    assignments.push("updated_at = ?")
    values.push(patch.updatedAt ?? new Date())
    values.push(id)

    await this.pool.query(
      `UPDATE accounts SET ${assignments.join(", ")} WHERE id = ?`,
      values,
    )
  }

  async deleteAccount(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM accounts WHERE id = ?`, [id])
    await this.pool.query(`DELETE FROM request_logs WHERE account_id = ?`, [id])
  }

  async insertRequestLog(log: RequestLogRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO request_logs (
          id,
          account_id,
          endpoint,
          model,
          status_code,
          error_type,
          duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
    const [rows] = await this.pool.query(
      "SELECT `key`, `value` FROM settings ORDER BY `key` ASC",
    )

    const result: Record<string, unknown> = {}
    for (const row of rows as Array<{ key: string; value: string }>) {
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
      await this.pool.query(
        `
          INSERT INTO settings (\`key\`, \`value\`)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = CURRENT_TIMESTAMP
        `,
        [key, serialized],
      )
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
