import type { StoredAccount } from "~/lib/data-store/types"
import type { ModelsResponse } from "~/services/copilot/get-models"

/** Database row type for an account */
export type AccountRecord = StoredAccount

/** Runtime account state extends persisted account data with ephemeral fields */
export interface AccountState {
  id: string
  label: string | null
  githubToken: string
  copilotToken: string | null
  accountType: string
  githubUsername: string | null
  status: "active" | "rate_limited" | "dead" | "forbidden" | "disabled"
  statusMessage: string | null
  statusUpdatedAt: Date | null
  isPremium: boolean
  totalRequests: number
  lastUsedAt: Date | null
  maxRequestsPerHour: number | null
  maxRequestsPerDay: number | null
  rotationWeight: number

  // Ephemeral runtime fields (not persisted directly)
  models: ModelsResponse | null
  vsCodeVersion: string | null
  refreshTimer: ReturnType<typeof setInterval> | null
  rateLimitResetTimer: ReturnType<typeof setTimeout> | null
  limitWindow: {
    hourly: {
      startedAt: number
      count: number
    }
    daily: {
      startedAt: number
      count: number
    }
  }
  lastKnownErrorCode: string | null
  lastKnownPremiumRemaining: number | null
  lastKnownPremiumUnlimited: boolean | null
}

/** Create an AccountState from a database record */
export function accountStateFromRecord(record: AccountRecord): AccountState {
  const now = Date.now()
  return {
    id: record.id,
    label: record.label,
    githubToken: record.githubToken,
    copilotToken: record.copilotToken ?? null,
    accountType: record.accountType,
    githubUsername: record.githubUsername,
    status: record.status,
    statusMessage: record.statusMessage,
    statusUpdatedAt: record.statusUpdatedAt,
    isPremium: record.isPremium ?? false,
    totalRequests: record.totalRequests ?? 0,
    lastUsedAt: record.lastUsedAt,
    maxRequestsPerHour: record.maxRequestsPerHour ?? null,
    maxRequestsPerDay: record.maxRequestsPerDay ?? null,
    rotationWeight: record.rotationWeight ?? 1,
    models: null,
    vsCodeVersion: null,
    refreshTimer: null,
    rateLimitResetTimer: null,
    limitWindow: {
      hourly: {
        startedAt: now,
        count: 0,
      },
      daily: {
        startedAt: now,
        count: 0,
      },
    },
    lastKnownErrorCode: null,
    lastKnownPremiumRemaining: null,
    lastKnownPremiumUnlimited: null,
  }
}

