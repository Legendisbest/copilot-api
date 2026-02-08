import type { NewStoredAccount, StoredAccount } from "./types"
import { sanitizeRotationWeight } from "./types"

const asDateOrNull = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const asNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? null : parsed
}

const asBoolean = (value: unknown): boolean => {
  return value === true || value === 1 || value === "1"
}

export const normalizeStoredAccount = (value: {
  id: unknown
  label?: unknown
  githubToken?: unknown
  copilotToken?: unknown
  copilotTokenExpiresAt?: unknown
  accountType?: unknown
  githubUsername?: unknown
  status?: unknown
  statusMessage?: unknown
  statusUpdatedAt?: unknown
  isPremium?: unknown
  totalRequests?: unknown
  lastUsedAt?: unknown
  maxRequestsPerHour?: unknown
  maxRequestsPerDay?: unknown
  rotationWeight?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}): StoredAccount => {
  const label =
    typeof value.label === "string" && value.label.length > 0 ?
      value.label
    : null
  const githubUsername =
    typeof value.githubUsername === "string" && value.githubUsername.length > 0 ?
      value.githubUsername
    : null
  const statusMessage =
    typeof value.statusMessage === "string" && value.statusMessage.length > 0 ?
      value.statusMessage
    : null

  return {
    id: String(value.id),
    label,
    githubToken:
      typeof value.githubToken === "string" ? value.githubToken : "",
    copilotToken:
      typeof value.copilotToken === "string" && value.copilotToken.length > 0 ?
        value.copilotToken
      : null,
    copilotTokenExpiresAt: asDateOrNull(value.copilotTokenExpiresAt),
    accountType:
      value.accountType === "business" || value.accountType === "enterprise" ?
        value.accountType
      : "individual",
    githubUsername,
    status:
      value.status === "rate_limited"
      || value.status === "dead"
      || value.status === "forbidden"
      || value.status === "disabled" ?
        value.status
      : "active",
    statusMessage,
    statusUpdatedAt: asDateOrNull(value.statusUpdatedAt),
    isPremium: asBoolean(value.isPremium),
    totalRequests: asNumberOrNull(value.totalRequests) ?? 0,
    lastUsedAt: asDateOrNull(value.lastUsedAt),
    maxRequestsPerHour: asNumberOrNull(value.maxRequestsPerHour),
    maxRequestsPerDay: asNumberOrNull(value.maxRequestsPerDay),
    rotationWeight: sanitizeRotationWeight(asNumberOrNull(value.rotationWeight)),
    createdAt: asDateOrNull(value.createdAt),
    updatedAt: asDateOrNull(value.updatedAt),
  }
}

export const normalizeNewStoredAccount = (
  value: NewStoredAccount,
): NewStoredAccount => ({
  githubToken: value.githubToken,
  label: value.label ?? null,
  accountType: value.accountType,
  githubUsername: value.githubUsername ?? null,
  status: value.status ?? "active",
  isPremium: value.isPremium ?? false,
  maxRequestsPerHour: value.maxRequestsPerHour ?? null,
  maxRequestsPerDay: value.maxRequestsPerDay ?? null,
  rotationWeight: sanitizeRotationWeight(value.rotationWeight),
})

