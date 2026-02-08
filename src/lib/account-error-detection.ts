import { HTTPError } from "./error"
import { accountStorage } from "./async-context"
import { accountManager } from "./account-manager"

/**
 * Detect account-level errors from upstream Copilot API responses.
 * When an HTTPError has status 401/403/429, update the current account's health.
 * No-op if not in multi-account mode (no account in AsyncLocalStorage).
 */
export function detectAccountError(error: unknown): void {
  if (!accountManager.isInitialized()) return

  const account = accountStorage.getStore()
  if (!account || !(error instanceof HTTPError)) return

  const status = error.response.status
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
