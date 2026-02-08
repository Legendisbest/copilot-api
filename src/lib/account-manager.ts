import consola from "consola"

import type { QuotaDetail } from "~/services/github/get-copilot-usage"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getGitHubUser } from "~/services/github/get-user"
import { getModels } from "~/services/copilot/get-models"

import type { AccountState } from "./account"
import { accountStateFromRecord } from "./account"
import { accountStorage } from "./async-context"
import { getDataStore, getDataStoreKind } from "./data-store"
import type { AccountType, StoredAccountPatch } from "./data-store/types"
import { state } from "./state"

type RotationStrategy = "round_robin" | "least_used" | "weighted" | "free_first"
type FreeAccountPolicy = "balanced" | "prefer_free" | "prefer_premium"

interface RuntimeSettings {
  rotationStrategy: RotationStrategy
  freeAccountPolicy: FreeAccountPolicy
  freeAccountExhaustedError: boolean
  freeAccountExhaustedErrorCode: string
}

interface SelectionError {
  status: number
  code: string
  message: string
}

const DEFAULT_SETTINGS: RuntimeSettings = {
  rotationStrategy: "round_robin",
  freeAccountPolicy: "prefer_free",
  freeAccountExhaustedError: false,
  freeAccountExhaustedErrorCode: "FREE_QUOTA_EXHAUSTED",
}

class AccountManager {
  private readonly accounts: Map<string, AccountState> = new Map()
  private rotationIndex = 0
  private initialized = false
  private runtimeSettings: RuntimeSettings = DEFAULT_SETTINGS
  private lastSelectionError: SelectionError | null = null

  isInitialized(): boolean {
    return this.initialized
  }

  getLastSelectionError(): SelectionError | null {
    return this.lastSelectionError
  }

  getRuntimeSettings(): RuntimeSettings {
    return this.runtimeSettings
  }

  async reloadSettings(): Promise<void> {
    try {
      const values = await getDataStore().getSettings()
      this.runtimeSettings = {
        rotationStrategy: parseRotationStrategy(values.rotation_strategy),
        freeAccountPolicy: parseFreeAccountPolicy(values.free_account_policy),
        freeAccountExhaustedError: parseBoolean(
          values.free_account_exhausted_error,
          DEFAULT_SETTINGS.freeAccountExhaustedError,
        ),
        freeAccountExhaustedErrorCode: parseString(
          values.free_account_exhausted_error_code,
          DEFAULT_SETTINGS.freeAccountExhaustedErrorCode,
        ),
      }
    } catch (error) {
      consola.warn("Failed to load runtime settings, using defaults", error)
      this.runtimeSettings = DEFAULT_SETTINGS
    }
  }

  /** Load all accounts from the configured store and set up token refresh */
  async initialize(): Promise<void> {
    const store = getDataStore()
    await this.reloadSettings()

    const records = await store.listAccounts()

    for (const record of records) {
      const accountState = accountStateFromRecord(record)
      accountState.vsCodeVersion = state.vsCodeVersion ?? null
      this.accounts.set(accountState.id, accountState)

      if (accountState.status === "active" || accountState.status === "rate_limited") {
        try {
          await this.setupTokenForAccount(accountState)
          await this.fetchModelsForAccount(accountState)
          await this.refreshUsageSnapshot(accountState)
        } catch (error) {
          consola.error(
            `Failed to initialize account ${accountState.label ?? accountState.id}:`,
            error,
          )
          accountState.status = "dead"
          accountState.statusMessage = `Init failed: ${(error as Error).message}`
          await this.persistStatus(accountState)
        }
      }
    }

    this.initialized = true
    consola.info(
      `Account manager initialized with ${this.accounts.size} account(s) using ${getDataStoreKind()} backend`,
    )
  }

  /** Add a new account to the pool */
  async addAccount(
    githubToken: string,
    label?: string,
    accountType: string = "individual",
  ): Promise<AccountState> {
    const normalizedAccountType = normalizeAccountType(accountType)

    const userInfo = await this.callWithToken(githubToken, normalizedAccountType, async () => {
      return await getGitHubUser()
    })
    const username = (userInfo as { login?: string }).login ?? "unknown"

    const record = await getDataStore().createAccount({
      githubToken,
      label: label ?? username,
      accountType: normalizedAccountType,
      githubUsername: username,
      status: "active",
      rotationWeight: 1,
    })

    const accountState = accountStateFromRecord(record)
    accountState.vsCodeVersion = state.vsCodeVersion ?? null
    this.accounts.set(accountState.id, accountState)

    try {
      await this.setupTokenForAccount(accountState)
      await this.fetchModelsForAccount(accountState)
      await this.refreshUsageSnapshot(accountState)
    } catch (error) {
      accountState.status = "dead"
      accountState.statusMessage = `Setup failed: ${(error as Error).message}`
      await this.persistStatus(accountState)
    }

    consola.success(`Added account: ${username} (${accountState.id})`)
    return accountState
  }

  /** Remove an account from the pool and DB */
  async removeAccount(id: string): Promise<void> {
    const account = this.accounts.get(id)
    if (!account) throw new Error(`Account ${id} not found`)

    if (account.refreshTimer) clearInterval(account.refreshTimer)
    if (account.rateLimitResetTimer) clearTimeout(account.rateLimitResetTimer)

    this.accounts.delete(id)
    await getDataStore().deleteAccount(id)
    consola.info(`Removed account: ${account.label ?? id}`)
  }

  /** Disable an account */
  async disableAccount(id: string): Promise<void> {
    const account = this.accounts.get(id)
    if (!account) throw new Error(`Account ${id} not found`)

    if (account.refreshTimer) clearInterval(account.refreshTimer)
    account.refreshTimer = null
    account.status = "disabled"
    account.statusMessage = "Disabled by admin"
    await this.persistStatus(account)
  }

  /** Re-enable a disabled account */
  async enableAccount(id: string): Promise<void> {
    const account = this.accounts.get(id)
    if (!account) throw new Error(`Account ${id} not found`)

    account.status = "active"
    account.statusMessage = null

    try {
      await this.setupTokenForAccount(account)
      await this.fetchModelsForAccount(account)
      await this.refreshUsageSnapshot(account)
    } catch (error) {
      account.status = "dead"
      account.statusMessage = `Re-enable failed: ${(error as Error).message}`
    }

    await this.persistStatus(account)
  }

  /** Force refresh token for an account */
  async refreshAccount(id: string): Promise<void> {
    const account = this.accounts.get(id)
    if (!account) throw new Error(`Account ${id} not found`)

    if (account.refreshTimer) clearInterval(account.refreshTimer)
    account.refreshTimer = null

    try {
      await this.setupTokenForAccount(account)
      await this.fetchModelsForAccount(account)
      await this.refreshUsageSnapshot(account)
      account.status = "active"
      account.statusMessage = null
    } catch (error) {
      account.status = "dead"
      account.statusMessage = `Refresh failed: ${(error as Error).message}`
    }

    await this.persistStatus(account)
  }

  async updateAccountConfig(
    id: string,
    patch: {
      label?: string | null
      maxRequestsPerHour?: number | null
      maxRequestsPerDay?: number | null
      rotationWeight?: number
    },
  ): Promise<void> {
    const account = this.accounts.get(id)
    if (!account) throw new Error(`Account ${id} not found`)

    const storePatch: StoredAccountPatch = {}
    if (patch.label !== undefined) {
      account.label = patch.label
      storePatch.label = patch.label
    }
    if (patch.maxRequestsPerHour !== undefined) {
      account.maxRequestsPerHour = normalizeNullableLimit(patch.maxRequestsPerHour)
      storePatch.maxRequestsPerHour = account.maxRequestsPerHour
    }
    if (patch.maxRequestsPerDay !== undefined) {
      account.maxRequestsPerDay = normalizeNullableLimit(patch.maxRequestsPerDay)
      storePatch.maxRequestsPerDay = account.maxRequestsPerDay
    }
    if (patch.rotationWeight !== undefined) {
      account.rotationWeight = normalizeRotationWeight(patch.rotationWeight)
      storePatch.rotationWeight = account.rotationWeight
    }

    await getDataStore().updateAccount(id, {
      ...storePatch,
      updatedAt: new Date(),
    })
  }

  resetAccountCounters(id: string): void {
    const account = this.accounts.get(id)
    if (!account) throw new Error(`Account ${id} not found`)
    const now = Date.now()
    account.limitWindow.hourly = { startedAt: now, count: 0 }
    account.limitWindow.daily = { startedAt: now, count: 0 }
    account.lastKnownErrorCode = null
  }

  /** Round-robin / weighted / least-used selection over active accounts */
  getNextAccount(): AccountState | null {
    const activeAccounts = Array.from(this.accounts.values()).filter(
      (a) => a.status === "active" && a.copilotToken,
    )

    if (activeAccounts.length === 0) {
      this.lastSelectionError = {
        status: 503,
        code: "NO_AVAILABLE_ACCOUNTS",
        message:
          "No available accounts. All accounts are rate-limited, dead, or disabled.",
      }
      return null
    }

    const availableByLimit = activeAccounts.filter((account) =>
      this.isWithinRequestLimits(account),
    )

    if (availableByLimit.length === 0) {
      this.lastSelectionError = {
        status: 429,
        code: "ACCOUNT_LIMIT_EXCEEDED",
        message:
          "All active accounts reached configured request limits. Increase limits or add accounts.",
      }
      return null
    }

    const policyApplied = this.applyFreePolicy(availableByLimit)
    if (policyApplied.length === 0) {
      this.lastSelectionError = {
        status: 429,
        code: this.runtimeSettings.freeAccountExhaustedErrorCode,
        message:
          "Free-tier accounts are exhausted and policy prevents premium fallback.",
      }
      return null
    }

    const selected = this.selectByStrategy(policyApplied)
    this.lastSelectionError = null
    return selected
  }

  getAccountById(id: string): AccountState | undefined {
    return this.accounts.get(id)
  }

  getAllAccounts(): AccountState[] {
    return Array.from(this.accounts.values())
  }

  /** Sort accounts for UI: free first, then by request count ascending */
  getAccountsSorted(): AccountState[] {
    return Array.from(this.accounts.values()).sort((a, b) => {
      const premiumDelta = Number(a.isPremium) - Number(b.isPremium)
      if (premiumDelta !== 0) return premiumDelta
      return a.totalRequests - b.totalRequests
    })
  }

  markRateLimited(id: string, retryAfterSeconds: number = 60): void {
    const account = this.accounts.get(id)
    if (!account) return

    account.status = "rate_limited"
    account.statusMessage = `Rate limited. Auto-recovery in ${retryAfterSeconds}s`
    account.statusUpdatedAt = new Date()
    this.persistStatus(account).catch(() => {})

    if (account.rateLimitResetTimer) clearTimeout(account.rateLimitResetTimer)

    account.rateLimitResetTimer = setTimeout(() => {
      consola.info(
        `Account ${account.label ?? id} rate limit cooldown expired, marking active`,
      )
      account.status = "active"
      account.statusMessage = null
      account.rateLimitResetTimer = null
      account.lastKnownErrorCode = null
      this.persistStatus(account).catch(() => {})
    }, retryAfterSeconds * 1000)

    consola.warn(
      `Account ${account.label ?? id} rate limited. Will recover in ${retryAfterSeconds}s`,
    )
  }

  markDead(id: string, message: string): void {
    const account = this.accounts.get(id)
    if (!account) return
    account.status = "dead"
    account.statusMessage = message
    account.lastKnownErrorCode = "ACCOUNT_DEAD"
    if (account.refreshTimer) {
      clearInterval(account.refreshTimer)
      account.refreshTimer = null
    }
    this.persistStatus(account).catch(() => {})
    consola.error(`Account ${account.label ?? id} marked dead: ${message}`)
  }

  markForbidden(id: string, message: string): void {
    const account = this.accounts.get(id)
    if (!account) return
    account.status = "forbidden"
    account.statusMessage = message
    account.lastKnownErrorCode = "ACCOUNT_FORBIDDEN"
    if (account.refreshTimer) {
      clearInterval(account.refreshTimer)
      account.refreshTimer = null
    }
    this.persistStatus(account).catch(() => {})
    consola.error(`Account ${account.label ?? id} marked forbidden: ${message}`)
  }

  async incrementRequestCount(id: string): Promise<void> {
    const account = this.accounts.get(id)
    if (!account) return

    const now = new Date()
    account.totalRequests += 1
    account.lastUsedAt = now

    this.bumpRequestWindows(account, now.getTime())

    try {
      await getDataStore().updateAccount(id, {
        totalRequestsIncrement: 1,
        lastUsedAt: now,
        updatedAt: now,
      })
    } catch {
      // non-critical
    }
  }

  async logRequest(
    accountId: string,
    endpoint: string,
    model: string | undefined,
    statusCode: number,
    errorType: string | null,
    durationMs: number,
  ): Promise<void> {
    try {
      await getDataStore().insertRequestLog({
        accountId,
        endpoint,
        model: model ?? null,
        statusCode,
        errorType,
        durationMs,
      })
    } catch {
      // non-critical
    }
  }

  async getStats(): Promise<{
    totalAccounts: number
    activeAccounts: number
    rateLimitedAccounts: number
    deadAccounts: number
    totalRequests: number
    freeAccounts: number
    premiumAccounts: number
    freeExhaustedAccounts: number
    dataStore: string
    rotationStrategy: RotationStrategy
    freeAccountPolicy: FreeAccountPolicy
  }> {
    const allAccounts = this.getAllAccounts()
    const freeExhaustedAccounts = allAccounts.filter((account) => {
      return (
        !account.isPremium
        && account.lastKnownPremiumUnlimited === false
        && (account.lastKnownPremiumRemaining ?? 0) <= 0
      )
    }).length

    return {
      totalAccounts: allAccounts.length,
      activeAccounts: allAccounts.filter((a) => a.status === "active").length,
      rateLimitedAccounts: allAccounts.filter((a) => a.status === "rate_limited")
        .length,
      deadAccounts: allAccounts.filter(
        (a) => a.status === "dead" || a.status === "forbidden",
      ).length,
      totalRequests: allAccounts.reduce((sum, a) => sum + a.totalRequests, 0),
      freeAccounts: allAccounts.filter((a) => !a.isPremium).length,
      premiumAccounts: allAccounts.filter((a) => a.isPremium).length,
      freeExhaustedAccounts,
      dataStore: getDataStoreKind(),
      rotationStrategy: this.runtimeSettings.rotationStrategy,
      freeAccountPolicy: this.runtimeSettings.freeAccountPolicy,
    }
  }

  // --- Private helpers ---

  private applyFreePolicy(candidates: Array<AccountState>): Array<AccountState> {
    const freeCandidates = candidates.filter((account) => !account.isPremium)
    const premiumCandidates = candidates.filter((account) => account.isPremium)

    if (this.runtimeSettings.freeAccountPolicy === "prefer_free") {
      const healthyFree = freeCandidates.filter((account) =>
        this.isFreeAccountUsable(account),
      )
      if (healthyFree.length > 0) {
        return healthyFree
      }
      if (
        this.runtimeSettings.freeAccountExhaustedError
        && freeCandidates.length > 0
      ) {
        return []
      }
      return premiumCandidates.length > 0 ? premiumCandidates : candidates
    }

    if (this.runtimeSettings.freeAccountPolicy === "prefer_premium") {
      return premiumCandidates.length > 0 ? premiumCandidates : candidates
    }

    return candidates
  }

  private isFreeAccountUsable(account: AccountState): boolean {
    if (account.isPremium) return true
    if (account.lastKnownPremiumUnlimited === true) return true
    if (account.lastKnownPremiumRemaining === null) return true
    return account.lastKnownPremiumRemaining > 0
  }

  private selectByStrategy(candidates: Array<AccountState>): AccountState {
    const strategy = this.runtimeSettings.rotationStrategy
    if (strategy === "least_used") {
      return [...candidates].sort((a, b) => {
        if (a.totalRequests !== b.totalRequests) {
          return a.totalRequests - b.totalRequests
        }
        const aLast = a.lastUsedAt?.getTime() ?? 0
        const bLast = b.lastUsedAt?.getTime() ?? 0
        return aLast - bLast
      })[0]
    }

    if (strategy === "weighted") {
      const weighted = candidates.map((account) => ({
        account,
        weight: normalizeRotationWeight(account.rotationWeight),
      }))
      const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
      let ticket = Math.random() * totalWeight
      for (const item of weighted) {
        ticket -= item.weight
        if (ticket <= 0) {
          return item.account
        }
      }
      return weighted[weighted.length - 1].account
    }

    const ordered =
      strategy === "free_first" ?
        [...candidates].sort((a, b) => {
          const premiumDelta = Number(a.isPremium) - Number(b.isPremium)
          if (premiumDelta !== 0) return premiumDelta
          if (a.totalRequests !== b.totalRequests) {
            return a.totalRequests - b.totalRequests
          }
          return a.id.localeCompare(b.id)
        })
      : [...candidates].sort((a, b) => a.id.localeCompare(b.id))

    this.rotationIndex = this.rotationIndex % ordered.length
    const selected = ordered[this.rotationIndex]
    this.rotationIndex += 1
    return selected
  }

  private resetWindowsIfNeeded(account: AccountState, nowMs: number): void {
    if (nowMs - account.limitWindow.hourly.startedAt >= 60 * 60 * 1000) {
      account.limitWindow.hourly.startedAt = nowMs
      account.limitWindow.hourly.count = 0
    }

    const dailyStart = new Date(account.limitWindow.daily.startedAt)
    const nowDate = new Date(nowMs)
    const isSameDay =
      dailyStart.getUTCFullYear() === nowDate.getUTCFullYear()
      && dailyStart.getUTCMonth() === nowDate.getUTCMonth()
      && dailyStart.getUTCDate() === nowDate.getUTCDate()
    if (!isSameDay) {
      account.limitWindow.daily.startedAt = nowMs
      account.limitWindow.daily.count = 0
    }
  }

  private isWithinRequestLimits(account: AccountState): boolean {
    const nowMs = Date.now()
    this.resetWindowsIfNeeded(account, nowMs)

    if (
      account.maxRequestsPerHour !== null
      && account.limitWindow.hourly.count >= account.maxRequestsPerHour
    ) {
      account.lastKnownErrorCode = "ACCOUNT_HOURLY_LIMIT_REACHED"
      return false
    }

    if (
      account.maxRequestsPerDay !== null
      && account.limitWindow.daily.count >= account.maxRequestsPerDay
    ) {
      account.lastKnownErrorCode = "ACCOUNT_DAILY_LIMIT_REACHED"
      return false
    }

    if (
      account.lastKnownErrorCode === "ACCOUNT_HOURLY_LIMIT_REACHED"
      || account.lastKnownErrorCode === "ACCOUNT_DAILY_LIMIT_REACHED"
    ) {
      account.lastKnownErrorCode = null
    }
    return true
  }

  private bumpRequestWindows(account: AccountState, nowMs: number): void {
    this.resetWindowsIfNeeded(account, nowMs)
    account.limitWindow.hourly.count += 1
    account.limitWindow.daily.count += 1
  }

  /** Set up copilot token for a specific account with auto-refresh */
  private async setupTokenForAccount(account: AccountState): Promise<void> {
    const tokenResponse = await this.callWithToken(
      account.githubToken,
      account.accountType,
      async () => {
        return await getCopilotToken()
      },
    )

    const { token, refresh_in } = tokenResponse as {
      token: string
      refresh_in: number
    }

    account.copilotToken = token

    try {
      await getDataStore().updateAccount(account.id, {
        copilotToken: token,
        copilotTokenExpiresAt: new Date(Date.now() + refresh_in * 1000),
        updatedAt: new Date(),
      })
    } catch {
      // non-critical
    }

    if (account.refreshTimer) clearInterval(account.refreshTimer)

    const refreshInSeconds = Math.max(120, refresh_in - 60)
    const refreshInterval = refreshInSeconds * 1000
    account.refreshTimer = setInterval(async () => {
      try {
        const refreshed = await this.callWithToken(
          account.githubToken,
          account.accountType,
          async () => getCopilotToken(),
        )
        const { token: newToken, refresh_in: nextRefreshIn } = refreshed as {
          token: string
          refresh_in: number
        }
        account.copilotToken = newToken

        try {
          await getDataStore().updateAccount(account.id, {
            copilotToken: newToken,
            copilotTokenExpiresAt: new Date(Date.now() + nextRefreshIn * 1000),
            updatedAt: new Date(),
          })
        } catch {
          // non-critical
        }
      } catch (error) {
        consola.error(
          `Failed to refresh token for account ${account.label ?? account.id}:`,
          error,
        )
        this.markDead(account.id, `Token refresh failed: ${(error as Error).message}`)
      }
    }, refreshInterval)
  }

  private async fetchModelsForAccount(account: AccountState): Promise<void> {
    const models = await this.callWithToken(
      account.githubToken,
      account.accountType,
      async () => getModels(),
    )
    account.models = models as AccountState["models"]
  }

  async refreshUsageSnapshot(account: AccountState): Promise<void> {
    try {
      const { getCopilotUsage } = await import("~/services/github/get-copilot-usage")
      const usage = await this.callWithToken(
        account.githubToken,
        account.accountType,
        async () => getCopilotUsage(),
      )
      this.applyUsageSnapshot(account, usage as { quota_snapshots?: { premium_interactions?: QuotaDetail } })
      await getDataStore().updateAccount(account.id, {
        isPremium: account.isPremium,
        updatedAt: new Date(),
      })
    } catch {
      // usage sync is best-effort
    }
  }

  private applyUsageSnapshot(
    account: AccountState,
    usage: { quota_snapshots?: { premium_interactions?: QuotaDetail } },
  ): void {
    const premiumSnapshot = usage.quota_snapshots?.premium_interactions
    if (!premiumSnapshot) {
      return
    }

    account.lastKnownPremiumRemaining = premiumSnapshot.remaining
    account.lastKnownPremiumUnlimited = premiumSnapshot.unlimited
    account.isPremium = premiumSnapshot.unlimited === true

    if (
      !account.isPremium
      && premiumSnapshot.unlimited === false
      && premiumSnapshot.remaining <= 0
    ) {
      account.lastKnownErrorCode = this.runtimeSettings.freeAccountExhaustedErrorCode
    } else if (
      account.lastKnownErrorCode === this.runtimeSettings.freeAccountExhaustedErrorCode
    ) {
      account.lastKnownErrorCode = null
    }
  }

  private async callWithToken<T>(
    githubToken: string,
    accountType: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const tempAccount: AccountState = {
      id: "",
      label: null,
      githubToken,
      copilotToken: null,
      accountType,
      githubUsername: null,
      status: "active",
      statusMessage: null,
      statusUpdatedAt: null,
      isPremium: false,
      totalRequests: 0,
      lastUsedAt: null,
      maxRequestsPerHour: null,
      maxRequestsPerDay: null,
      rotationWeight: 1,
      models: null,
      vsCodeVersion: state.vsCodeVersion ?? null,
      refreshTimer: null,
      rateLimitResetTimer: null,
      limitWindow: {
        hourly: {
          startedAt: Date.now(),
          count: 0,
        },
        daily: {
          startedAt: Date.now(),
          count: 0,
        },
      },
      lastKnownErrorCode: null,
      lastKnownPremiumRemaining: null,
      lastKnownPremiumUnlimited: null,
    }

    return accountStorage.run(tempAccount, fn)
  }

  private async persistStatus(account: AccountState): Promise<void> {
    try {
      await getDataStore().updateAccount(account.id, {
        status: account.status,
        statusMessage: account.statusMessage,
        statusUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
    } catch {
      // non-critical
    }
  }
}

const normalizeAccountType = (accountType: string): AccountType => {
  if (accountType === "business" || accountType === "enterprise") {
    return accountType
  }
  return "individual"
}

const parseRotationStrategy = (value: unknown): RotationStrategy => {
  if (
    value === "round_robin"
    || value === "least_used"
    || value === "weighted"
    || value === "free_first"
  ) {
    return value
  }
  return DEFAULT_SETTINGS.rotationStrategy
}

const parseFreeAccountPolicy = (value: unknown): FreeAccountPolicy => {
  if (
    value === "balanced"
    || value === "prefer_free"
    || value === "prefer_premium"
  ) {
    return value
  }
  return DEFAULT_SETTINGS.freeAccountPolicy
}

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const lowered = value.toLowerCase()
    if (lowered === "true" || lowered === "1") return true
    if (lowered === "false" || lowered === "0") return false
  }
  return fallback
}

const parseString = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

const normalizeNullableLimit = (value: number | null): number | null => {
  if (value === null) return null
  if (!Number.isFinite(value)) return null
  const floored = Math.floor(value)
  return floored > 0 ? floored : null
}

const normalizeRotationWeight = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

export const accountManager = new AccountManager()

