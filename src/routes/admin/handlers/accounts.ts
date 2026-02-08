import type { Context } from "hono"

import { accountManager } from "~/lib/account-manager"
import { getDeviceCode } from "~/services/github/get-device-code"
import { pollAccessToken } from "~/services/github/poll-access-token"
import type { DeviceCodeResponse } from "~/services/github/get-device-code"

// Store active device flow sessions in memory
const activeDeviceFlows = new Map<
  string,
  {
    deviceCode: DeviceCodeResponse
    label?: string
    accountType: string
    polling: boolean
    result?: { success: boolean; accountId?: string; error?: string }
  }
>()

/** List all accounts (sorted: free first, then by total requests) */
export async function listAccounts(c: Context) {
  const accounts = accountManager.getAccountsSorted()

  const accountList = accounts.map((acc) => ({
    id: acc.id,
    label: acc.label,
    githubUsername: acc.githubUsername,
    accountType: acc.accountType,
    status: acc.status,
    statusMessage: acc.statusMessage,
    isPremium: acc.isPremium,
    totalRequests: acc.totalRequests,
    lastUsedAt: acc.lastUsedAt,
    maxRequestsPerHour: acc.maxRequestsPerHour,
    maxRequestsPerDay: acc.maxRequestsPerDay,
    rotationWeight: acc.rotationWeight,
    errorCode: acc.lastKnownErrorCode,
    premiumRemaining: acc.lastKnownPremiumRemaining,
    premiumUnlimited: acc.lastKnownPremiumUnlimited,
    hasCopilotToken: !!acc.copilotToken,
    modelCount: acc.models?.data?.length ?? 0,
  }))

  return c.json(accountList)
}

/** Add a new account by providing a GitHub token directly */
export async function addAccount(c: Context) {
  const body = await c.req.json<{
    githubToken: string
    label?: string
    accountType?: string
  }>()

  if (!body.githubToken) {
    return c.json({ error: "githubToken is required" }, 400)
  }

  try {
    const account = await accountManager.addAccount(
      body.githubToken,
      body.label,
      body.accountType ?? "individual",
    )
    return c.json(
      {
        id: account.id,
        label: account.label,
        githubUsername: account.githubUsername,
        status: account.status,
        isPremium: account.isPremium,
      },
      201,
    )
  } catch (error) {
    return c.json(
      { error: `Failed to add account: ${(error as Error).message}` },
      400,
    )
  }
}

/** Remove an account */
export async function removeAccount(c: Context) {
  const id = c.req.param("id")
  try {
    await accountManager.removeAccount(id)
    return c.json({ success: true })
  } catch (error) {
    return c.json(
      { error: `Failed to remove account: ${(error as Error).message}` },
      404,
    )
  }
}

/** Update an account (label, limits, enable/disable, reset counters) */
export async function updateAccount(c: Context) {
  const id = c.req.param("id")
  const body = await c.req.json<{
    action?: string
    label?: string | null
    maxRequestsPerHour?: number | null
    maxRequestsPerDay?: number | null
    rotationWeight?: number
  }>()

  try {
    if (body.action === "enable") {
      await accountManager.enableAccount(id)
    } else if (body.action === "disable") {
      await accountManager.disableAccount(id)
    } else if (body.action === "reset_counters") {
      accountManager.resetAccountCounters(id)
    }

    const hasConfigUpdate =
      body.label !== undefined
      || body.maxRequestsPerHour !== undefined
      || body.maxRequestsPerDay !== undefined
      || body.rotationWeight !== undefined

    if (hasConfigUpdate) {
      await accountManager.updateAccountConfig(id, {
        label: body.label,
        maxRequestsPerHour:
          body.maxRequestsPerHour === undefined ? undefined : body.maxRequestsPerHour,
        maxRequestsPerDay:
          body.maxRequestsPerDay === undefined ? undefined : body.maxRequestsPerDay,
        rotationWeight: body.rotationWeight,
      })
    }

    const account = accountManager.getAccountById(id)
    if (!account) return c.json({ error: "Account not found" }, 404)

    return c.json({
      id: account.id,
      label: account.label,
      status: account.status,
      statusMessage: account.statusMessage,
      maxRequestsPerHour: account.maxRequestsPerHour,
      maxRequestsPerDay: account.maxRequestsPerDay,
      rotationWeight: account.rotationWeight,
      errorCode: account.lastKnownErrorCode,
    })
  } catch (error) {
    return c.json(
      { error: `Failed to update account: ${(error as Error).message}` },
      400,
    )
  }
}

/** Force refresh token for an account */
export async function refreshAccountToken(c: Context) {
  const id = c.req.param("id")
  try {
    await accountManager.refreshAccount(id)
    const account = accountManager.getAccountById(id)
    return c.json({
      id: account?.id,
      status: account?.status,
      statusMessage: account?.statusMessage,
    })
  } catch (error) {
    return c.json(
      { error: `Failed to refresh account: ${(error as Error).message}` },
      400,
    )
  }
}

/** Start a GitHub device flow for adding a new account */
export async function startDeviceFlow(c: Context) {
  const body = await c.req.json<{
    label?: string
    accountType?: string
  }>().catch(() => ({}))

  try {
    const deviceCode = await getDeviceCode()
    const flowId = crypto.randomUUID()

    activeDeviceFlows.set(flowId, {
      deviceCode,
      label: (body as { label?: string }).label,
      accountType: (body as { accountType?: string }).accountType ?? "individual",
      polling: false,
    })

    // Auto-cleanup after expiry
    setTimeout(
      () => activeDeviceFlows.delete(flowId),
      deviceCode.expires_in * 1000,
    )

    return c.json({
      flowId,
      userCode: deviceCode.user_code,
      verificationUri: deviceCode.verification_uri,
      expiresIn: deviceCode.expires_in,
    })
  } catch (error) {
    return c.json(
      { error: `Failed to start device flow: ${(error as Error).message}` },
      500,
    )
  }
}

/** Poll a device flow for completion */
export async function pollDeviceFlow(c: Context) {
  const body = await c.req.json<{ flowId: string }>()

  const flow = activeDeviceFlows.get(body.flowId)
  if (!flow) {
    return c.json({ error: "Device flow not found or expired" }, 404)
  }

  // If already completed
  if (flow.result) {
    activeDeviceFlows.delete(body.flowId)
    return c.json(flow.result)
  }

  // Start polling if not already
  if (!flow.polling) {
    flow.polling = true

    // Poll in the background
    pollAccessToken(flow.deviceCode)
      .then(async (githubToken) => {
        try {
          const account = await accountManager.addAccount(
            githubToken,
            flow.label,
            flow.accountType,
          )
          flow.result = { success: true, accountId: account.id }
        } catch (error) {
          flow.result = {
            success: false,
            error: (error as Error).message,
          }
        }
      })
      .catch((error) => {
        flow.result = {
          success: false,
          error: (error as Error).message,
        }
      })
  }

  return c.json({ status: "pending", message: "Waiting for user authorization..." })
}

/** Get per-account usage from GitHub */
export async function getAccountUsage(c: Context) {
  const id = c.req.param("id")
  const account = accountManager.getAccountById(id)

  if (!account) {
    return c.json({ error: "Account not found" }, 404)
  }

  if (account.status !== "active" || !account.copilotToken) {
    return c.json(
      { error: "Account is not active or has no valid token" },
      400,
    )
  }

  try {
    const { getCopilotUsage } = await import(
      "~/services/github/get-copilot-usage"
    )
    const { accountStorage } = await import("~/lib/async-context")

    // Run with account's credentials
    const usage = await accountStorage.run(account, () => getCopilotUsage())
    await accountManager.refreshUsageSnapshot(account)
    return c.json(usage)
  } catch (error) {
    return c.json(
      { error: `Failed to fetch usage: ${(error as Error).message}` },
      500,
    )
  }
}

/** Get aggregated stats */
export async function getStats(c: Context) {
  const stats = await accountManager.getStats()
  return c.json(stats)
}

/** Refresh tokens/models for all non-disabled accounts */
export async function refreshAllAccounts(c: Context) {
  try {
    const result = await accountManager.refreshAllAccounts()
    return c.json({ success: true, ...result })
  } catch (error) {
    return c.json(
      { error: `Failed to refresh all accounts: ${(error as Error).message}` },
      500,
    )
  }
}

/** Reset hourly/daily counters for all accounts */
export async function resetAllCounters(c: Context) {
  try {
    const updated = accountManager.resetAllCounters()
    return c.json({ success: true, updated })
  } catch (error) {
    return c.json(
      { error: `Failed to reset counters: ${(error as Error).message}` },
      500,
    )
  }
}

/** Rebalance rotation weights: premium=3, free=1 */
export async function rebalanceWeights(c: Context) {
  try {
    await accountManager.rebalanceRotationWeights()
    return c.json({ success: true })
  } catch (error) {
    return c.json(
      { error: `Failed to rebalance weights: ${(error as Error).message}` },
      500,
    )
  }
}
