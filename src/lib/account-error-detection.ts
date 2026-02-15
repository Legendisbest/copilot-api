import { HTTPError } from "./error"
import { accountStorage } from "./async-context"
import { accountManager } from "./account-manager"

/**
 * Detect account-level errors from upstream Copilot API responses.
 * When an HTTPError has status 401/403/429, update the current account's health.
 * No-op if not in multi-account mode (no account in AsyncLocalStorage).
 */
export async function detectAccountError(error: unknown): Promise<void> {
  if (!accountManager.isInitialized()) return

  const account = accountStorage.getStore()
  if (!account || !(error instanceof HTTPError)) return

  const status = error.response.status

  // Billing/quota issues (and some account-level "hard limit" errors): disable the account so
  // rotation won't keep selecting it.
  // Example payloads:
  // - {"error":{"message":"You have no quota","code":"quota_exceeded"}}
  // - {"error":{"message":"You have reached an internal limit. Please contact support ..."}}
  if (status >= 400) {
    try {
      const details = await parseUpstreamErrorDetails(error.response)
      const code = details.code?.toLowerCase() ?? null
      const message = details.message?.toLowerCase() ?? null
      const rawText = details.rawText.toLowerCase()

      const isQuotaExceeded =
        code === "quota_exceeded"
        || code === "insufficient_quota"
        || rawText.includes("\"code\":\"quota_exceeded\"")
        || rawText.includes("quota_exceeded")
        || message?.includes("no quota") === true

      if (isQuotaExceeded) {
        accountManager.markDisabled(
          account.id,
          "Disabled automatically: quota exceeded (billing/quota issue)",
          "ACCOUNT_QUOTA_EXCEEDED",
        )
        return
      }

      const isInternalLimit =
        code === "internal_limit"
        || code === "internal_limit_reached"
        || message?.includes("reached an internal limit") === true
        || message?.includes("internal limit") === true
        || rawText.includes("reached an internal limit")

      if (isInternalLimit) {
        accountManager.markDisabled(
          account.id,
          "Disabled automatically: internal limit reached (contact support)",
          "ACCOUNT_INTERNAL_LIMIT",
        )
        return
      }
    } catch {
      // non-critical
    }
  }

  if (status === 401) {
    accountManager.markDead(account.id, "401 Unauthorized")
  } else if (status === 403) {
    accountManager.markForbidden(account.id, "403 Forbidden")
  } else if (status === 429) {
    const retryAfter = error.response.headers.get("retry-after")
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60
    accountManager.markRateLimited(
      account.id,
      Number.isNaN(retrySeconds) ? 60 : retrySeconds,
    )
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractErrorDetailsFromJson(
  value: unknown,
): { code: string | null; message: string | null } {
  if (!isRecord(value)) return { code: null, message: null }

  const topCode = asNonEmptyString(value.code)
  const topMessage = asNonEmptyString(value.message)

  const errorValue = value.error
  if (!isRecord(errorValue)) {
    return { code: topCode, message: topMessage }
  }

  return {
    code: asNonEmptyString(errorValue.code) ?? topCode,
    message: asNonEmptyString(errorValue.message) ?? topMessage,
  }
}

async function parseUpstreamErrorDetails(
  response: Response,
): Promise<{ code: string | null; message: string | null; rawText: string }> {
  const rawText = await response.clone().text()
  const trimmed = rawText.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { code: null, message: null, rawText }
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    const extracted = extractErrorDetailsFromJson(parsed)
    return { ...extracted, rawText }
  } catch {
    return { code: null, message: null, rawText }
  }
}
