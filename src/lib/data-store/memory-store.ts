import { randomUUID } from "node:crypto"

import {
  normalizeNewStoredAccount,
  normalizeStoredAccount,
} from "./shared"
import type {
  DataStore,
  NewStoredAccount,
  RequestLogRecord,
  StoredAccount,
  StoredAccountPatch,
} from "./types"
import { sanitizeRotationWeight } from "./types"

export class MemoryDataStore implements DataStore {
  kind = "memory" as const

  private readonly accounts = new Map<string, StoredAccount>()
  private readonly settings = new Map<string, unknown>()
  // kept for parity/debugging; currently not queried
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private readonly requestLogs = new Array<
    RequestLogRecord & { requestedAt: Date; id: string }
  >()

  async initialize(): Promise<void> {}

  async listAccounts(): Promise<Array<StoredAccount>> {
    return Array.from(this.accounts.values()).map((account) =>
      normalizeStoredAccount(account),
    )
  }

  async createAccount(input: NewStoredAccount): Promise<StoredAccount> {
    const normalized = normalizeNewStoredAccount(input)
    const now = new Date()
    const account: StoredAccount = {
      id: randomUUID(),
      label: normalized.label ?? null,
      githubToken: normalized.githubToken,
      copilotToken: null,
      copilotTokenExpiresAt: null,
      accountType: normalized.accountType,
      githubUsername: normalized.githubUsername ?? null,
      status: normalized.status ?? "active",
      statusMessage: null,
      statusUpdatedAt: now,
      isPremium: normalized.isPremium ?? false,
      totalRequests: 0,
      lastUsedAt: null,
      maxRequestsPerHour: normalized.maxRequestsPerHour ?? null,
      maxRequestsPerDay: normalized.maxRequestsPerDay ?? null,
      rotationWeight: sanitizeRotationWeight(normalized.rotationWeight),
      createdAt: now,
      updatedAt: now,
    }
    this.accounts.set(account.id, account)
    return normalizeStoredAccount(account)
  }

  async updateAccount(id: string, patch: StoredAccountPatch): Promise<void> {
    const current = this.accounts.get(id)
    if (!current) {
      throw new Error(`Account ${id} not found`)
    }

    const updated: StoredAccount = {
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.githubToken !== undefined ?
        { githubToken: patch.githubToken }
      : {}),
      ...(patch.copilotToken !== undefined ?
        { copilotToken: patch.copilotToken }
      : {}),
      ...(patch.copilotTokenExpiresAt !== undefined ? {
          copilotTokenExpiresAt: patch.copilotTokenExpiresAt,
        }
      : {}),
      ...(patch.accountType !== undefined ? { accountType: patch.accountType } : {}),
      ...(patch.githubUsername !== undefined ?
        { githubUsername: patch.githubUsername }
      : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.statusMessage !== undefined ?
        { statusMessage: patch.statusMessage }
      : {}),
      ...(patch.statusUpdatedAt !== undefined ? {
          statusUpdatedAt: patch.statusUpdatedAt,
        }
      : {}),
      ...(patch.isPremium !== undefined ? { isPremium: patch.isPremium } : {}),
      ...(patch.totalRequests !== undefined ?
        { totalRequests: patch.totalRequests }
      : {}),
      ...(patch.lastUsedAt !== undefined ? { lastUsedAt: patch.lastUsedAt } : {}),
      ...(patch.maxRequestsPerHour !== undefined ? {
          maxRequestsPerHour: patch.maxRequestsPerHour,
        }
      : {}),
      ...(patch.maxRequestsPerDay !== undefined ? {
          maxRequestsPerDay: patch.maxRequestsPerDay,
        }
      : {}),
      ...(patch.rotationWeight !== undefined ? {
          rotationWeight: sanitizeRotationWeight(patch.rotationWeight),
        }
      : {}),
      updatedAt: patch.updatedAt ?? new Date(),
    }

    if (patch.totalRequestsIncrement !== undefined) {
      updated.totalRequests = Math.max(
        0,
        updated.totalRequests + patch.totalRequestsIncrement,
      )
    }

    this.accounts.set(id, updated)
  }

  async deleteAccount(id: string): Promise<void> {
    this.accounts.delete(id)
  }

  async insertRequestLog(log: RequestLogRecord): Promise<void> {
    this.requestLogs.push({
      ...log,
      id: randomUUID(),
      requestedAt: new Date(),
    })
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.settings.entries())
  }

  async upsertSettings(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      this.settings.set(key, value)
    }
  }
}

