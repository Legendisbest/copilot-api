import { createMiddleware } from "hono/factory"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { accountManager } from "~/lib/account-manager"
import { accountStorage } from "~/lib/async-context"

/**
 * Hono middleware that selects the next account via round-robin and sets
 * it in AsyncLocalStorage so the state Proxy returns per-account values.
 * No-op when account manager is not initialized (legacy single-account mode).
 */
export const accountRotation = createMiddleware(async (c, next) => {
  if (!accountManager.isInitialized()) {
    return next()
  }

  const account = accountManager.getNextAccount()
  if (!account) {
    const selectionError = accountManager.getLastSelectionError()
    return c.json(
      {
        error: {
          message:
            selectionError?.message
            ?? "No available accounts. All accounts are rate-limited, dead, or disabled.",
          code: selectionError?.code ?? "NO_AVAILABLE_ACCOUNTS",
          type: "service_unavailable",
        },
      },
      (selectionError?.status ?? 503) as ContentfulStatusCode,
    )
  }

  c.set("account", account)

  // Run the rest of the request inside AsyncLocalStorage context.
  // This makes state.copilotToken etc. return this account's values.
  return accountStorage.run(account, async () => {
    const startTime = Date.now()
    await next()
    const durationMs = Date.now() - startTime

    // Increment request count for bill splitting
    accountManager.incrementRequestCount(account.id).catch(() => {})

    // Log the request
    const endpoint = c.req.path
    const statusCode = c.res.status
    const body = c.req.header("content-type")?.includes("json")
      ? await c.req
          .raw.clone()
          .json()
          .catch(() => null)
      : null
    const model = (body as Record<string, unknown> | null)?.model as string | undefined

    accountManager
      .logRequest(
        account.id,
        endpoint,
        model,
        statusCode,
        statusCode >= 400 ? `http_${statusCode}` : null,
        durationMs,
      )
      .catch(() => {})
  })
})
