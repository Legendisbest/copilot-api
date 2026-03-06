import { useEffect, useMemo, useState } from "react"

import { fetchSettings, updateSettings } from "../api/client"

type RotationStrategy = "round_robin" | "least_used" | "weighted" | "free_first"
type FreePolicy = "balanced" | "prefer_free" | "prefer_premium"

interface RuntimeSettings {
  rotationStrategy?: RotationStrategy
  freeAccountPolicy?: FreePolicy
  freeAccountExhaustedError?: boolean
  freeAccountExhaustedErrorCode?: string
  limitEnforcementEnabled?: boolean
  autoDisableFreeExhausted?: boolean
  autoDisableOnLimitReached?: boolean
  defaultMaxRequestsPerHour?: number | null
  defaultMaxRequestsPerDay?: number | null
  defaultRateLimitCooldownSeconds?: number
}

interface TrafficSettings {
  enabled?: boolean
  minDelayMs?: number
  delayJitterMs?: number
  maxConcurrentRequests?: number | null
  queueEnabled?: boolean
  maxQueueSize?: number
  maxQueueWaitMs?: number
  maxRequestsPerMinute?: number | null
  maxRequestsPerHour?: number | null
  maxRequestsPerDay?: number | null
}

interface TrafficStats {
  activeRequests?: number
  queuedRequests?: number
  nextRequestNotBefore?: string | null
  minuteCount?: number
  hourCount?: number
  dayCount?: number
}

interface SettingsResponse {
  rotation_strategy?: RotationStrategy
  free_account_policy?: FreePolicy
  free_account_exhausted_error?: boolean
  free_account_exhausted_error_code?: string
  limit_enforcement_enabled?: boolean
  auto_disable_free_exhausted?: boolean
  auto_disable_on_limit_reached?: boolean
  default_max_requests_per_hour?: number | null
  default_max_requests_per_day?: number | null
  default_rate_limit_cooldown_seconds?: number
  traffic_control_enabled?: boolean
  global_min_delay_ms?: number
  global_delay_jitter_ms?: number
  global_max_concurrent_requests?: number | null
  global_queue_enabled?: boolean
  global_max_queue_size?: number
  global_max_queue_wait_ms?: number
  global_max_requests_per_minute?: number | null
  global_max_requests_per_hour?: number | null
  global_max_requests_per_day?: number | null
  _meta?: {
    dataStore?: string
    persistent?: boolean
    runtime?: RuntimeSettings
    traffic?: TrafficSettings
    trafficStats?: TrafficStats
  }
  [key: string]: unknown
}

const formatNullableNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return ""
  }
  return String(value)
}

const parseNullableNumber = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return null
  return parsed
}

const parsePositiveNumber = (raw: string, fallback: number): number => {
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

const parseNonNegativeNumber = (raw: string, fallback: number): number => {
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback
  }
  return parsed
}

const formatNextSlot = (value: string | null | undefined): string => {
  if (!value) return "available now"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")

  const [rotationStrategy, setRotationStrategy] =
    useState<RotationStrategy>("round_robin")
  const [freePolicy, setFreePolicy] = useState<FreePolicy>("prefer_free")
  const [freeErrorEnabled, setFreeErrorEnabled] = useState(false)
  const [freeErrorCode, setFreeErrorCode] = useState("FREE_QUOTA_EXHAUSTED")
  const [limitEnforcementEnabled, setLimitEnforcementEnabled] = useState(true)
  const [autoDisableFreeExhausted, setAutoDisableFreeExhausted] = useState(false)
  const [autoDisableOnLimitReached, setAutoDisableOnLimitReached] = useState(false)
  const [defaultHourlyLimit, setDefaultHourlyLimit] = useState("")
  const [defaultDailyLimit, setDefaultDailyLimit] = useState("")
  const [cooldownSeconds, setCooldownSeconds] = useState("60")

  const [trafficControlEnabled, setTrafficControlEnabled] = useState(true)
  const [minDelayMs, setMinDelayMs] = useState("0")
  const [delayJitterMs, setDelayJitterMs] = useState("0")
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState("")
  const [queueEnabled, setQueueEnabled] = useState(false)
  const [maxQueueSize, setMaxQueueSize] = useState("100")
  const [maxQueueWaitMs, setMaxQueueWaitMs] = useState("900000")
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = useState("")
  const [maxRequestsPerHour, setMaxRequestsPerHour] = useState("")
  const [maxRequestsPerDay, setMaxRequestsPerDay] = useState("")

  const dataStoreLabel = useMemo(() => {
    const dataStore = settings._meta?.dataStore
    const persistent = settings._meta?.persistent
    if (!dataStore) return "unknown"
    return `${dataStore}${persistent ? " (persistent)" : " (memory)"}`
  }, [settings._meta?.dataStore, settings._meta?.persistent])

  const trafficStats = settings._meta?.trafficStats

  function applySettingsResponse(typed: SettingsResponse) {
    const runtime = typed._meta?.runtime
    const traffic = typed._meta?.traffic
    setSettings(typed)

    setRotationStrategy(
      runtime?.rotationStrategy ?? typed.rotation_strategy ?? "round_robin",
    )
    setFreePolicy(
      runtime?.freeAccountPolicy ?? typed.free_account_policy ?? "prefer_free",
    )
    setFreeErrorEnabled(
      runtime?.freeAccountExhaustedError
        ?? typed.free_account_exhausted_error
        ?? false,
    )
    setFreeErrorCode(
      runtime?.freeAccountExhaustedErrorCode
        ?? typed.free_account_exhausted_error_code
        ?? "FREE_QUOTA_EXHAUSTED",
    )
    setLimitEnforcementEnabled(
      runtime?.limitEnforcementEnabled
        ?? typed.limit_enforcement_enabled
        ?? true,
    )
    setAutoDisableFreeExhausted(
      runtime?.autoDisableFreeExhausted
        ?? typed.auto_disable_free_exhausted
        ?? false,
    )
    setAutoDisableOnLimitReached(
      runtime?.autoDisableOnLimitReached
        ?? typed.auto_disable_on_limit_reached
        ?? false,
    )
    setDefaultHourlyLimit(
      formatNullableNumber(
        runtime?.defaultMaxRequestsPerHour ?? typed.default_max_requests_per_hour,
      ),
    )
    setDefaultDailyLimit(
      formatNullableNumber(
        runtime?.defaultMaxRequestsPerDay ?? typed.default_max_requests_per_day,
      ),
    )
    setCooldownSeconds(
      String(
        runtime?.defaultRateLimitCooldownSeconds
          ?? typed.default_rate_limit_cooldown_seconds
          ?? 60,
      ),
    )

    setTrafficControlEnabled(
      traffic?.enabled ?? typed.traffic_control_enabled ?? true,
    )
    setMinDelayMs(String(traffic?.minDelayMs ?? typed.global_min_delay_ms ?? 0))
    setDelayJitterMs(
      String(traffic?.delayJitterMs ?? typed.global_delay_jitter_ms ?? 0),
    )
    setMaxConcurrentRequests(
      formatNullableNumber(
        traffic?.maxConcurrentRequests ?? typed.global_max_concurrent_requests,
      ),
    )
    setQueueEnabled(traffic?.queueEnabled ?? typed.global_queue_enabled ?? false)
    setMaxQueueSize(
      String(traffic?.maxQueueSize ?? typed.global_max_queue_size ?? 100),
    )
    setMaxQueueWaitMs(
      String(traffic?.maxQueueWaitMs ?? typed.global_max_queue_wait_ms ?? 900000),
    )
    setMaxRequestsPerMinute(
      formatNullableNumber(
        traffic?.maxRequestsPerMinute ?? typed.global_max_requests_per_minute,
      ),
    )
    setMaxRequestsPerHour(
      formatNullableNumber(
        traffic?.maxRequestsPerHour ?? typed.global_max_requests_per_hour,
      ),
    )
    setMaxRequestsPerDay(
      formatNullableNumber(
        traffic?.maxRequestsPerDay ?? typed.global_max_requests_per_day,
      ),
    )
  }

  useEffect(() => {
    fetchSettings()
      .then((raw) => applySettingsResponse(raw as SettingsResponse))
      .catch((error) => {
        setMessage(`Error loading settings: ${(error as Error).message}`)
      })
      .finally(() => setLoading(false))
  }, [])

  async function saveRuntimeSettings() {
    setSaving(true)
    setMessage(null)
    try {
      const parsedCooldown = Number.parseInt(cooldownSeconds, 10)
      const safeCooldown =
        Number.isNaN(parsedCooldown) || parsedCooldown <= 0 ? 60 : parsedCooldown

      await updateSettings({
        rotation_strategy: rotationStrategy,
        free_account_policy: freePolicy,
        free_account_exhausted_error: freeErrorEnabled,
        free_account_exhausted_error_code:
          freeErrorCode.trim() || "FREE_QUOTA_EXHAUSTED",
        limit_enforcement_enabled: limitEnforcementEnabled,
        auto_disable_free_exhausted: autoDisableFreeExhausted,
        auto_disable_on_limit_reached: autoDisableOnLimitReached,
        default_max_requests_per_hour: parseNullableNumber(defaultHourlyLimit),
        default_max_requests_per_day: parseNullableNumber(defaultDailyLimit),
        default_rate_limit_cooldown_seconds: safeCooldown,
        traffic_control_enabled: trafficControlEnabled,
        global_min_delay_ms: parseNonNegativeNumber(minDelayMs, 0),
        global_delay_jitter_ms: parseNonNegativeNumber(delayJitterMs, 0),
        global_max_concurrent_requests: parseNullableNumber(maxConcurrentRequests),
        global_queue_enabled: queueEnabled,
        global_max_queue_size: parsePositiveNumber(maxQueueSize, 100),
        global_max_queue_wait_ms: parsePositiveNumber(maxQueueWaitMs, 900000),
        global_max_requests_per_minute: parseNullableNumber(maxRequestsPerMinute),
        global_max_requests_per_hour: parseNullableNumber(maxRequestsPerHour),
        global_max_requests_per_day: parseNullableNumber(maxRequestsPerDay),
      })

      const refreshed = (await fetchSettings()) as SettingsResponse
      applySettingsResponse(refreshed)
      setMessage("Runtime settings saved.")
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!newPassword) return

    setSaving(true)
    setMessage(null)
    try {
      await updateSettings({ admin_password: newPassword })
      setMessage(
        "Password updated for this runtime. Set ADMIN_PASSWORD env var to persist across restarts.",
      )
      setNewPassword("")
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-gray-400 text-center py-12">Loading settings...</div>
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h2 className="text-lg font-bold text-white">Settings</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Data Backend</h3>
        <p className="text-sm text-gray-300 mb-1">
          Active backend: <span className="font-mono text-blue-300">{dataStoreLabel}</span>
        </p>
        <p className="text-xs text-gray-500">
          Start with one URL: <code>--database-url</code>, <code>--mysql-url</code>, or{" "}
          <code>--mongodb-url</code>. Optional override: <code>--db-client</code>.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-semibold text-white">Rotation & Billing</h3>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Rotation strategy
            <select
              value={rotationStrategy}
              onChange={(event) =>
                setRotationStrategy(event.target.value as RotationStrategy)
              }
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="round_robin">Round Robin</option>
              <option value="least_used">Least Used</option>
              <option value="weighted">Weighted</option>
              <option value="free_first">Free First</option>
            </select>
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Free-tier policy
            <select
              value={freePolicy}
              onChange={(event) => setFreePolicy(event.target.value as FreePolicy)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="prefer_free">Prefer Free</option>
              <option value="balanced">Balanced</option>
              <option value="prefer_premium">Prefer Premium</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Default max requests/hour
            <input
              value={defaultHourlyLimit}
              onChange={(event) => setDefaultHourlyLimit(event.target.value)}
              placeholder="empty = no default"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Default max requests/day
            <input
              value={defaultDailyLimit}
              onChange={(event) => setDefaultDailyLimit(event.target.value)}
              placeholder="empty = no default"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Rate limit cooldown seconds
            <input
              value={cooldownSeconds}
              onChange={(event) => setCooldownSeconds(event.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <div className="space-y-2 text-xs text-gray-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={limitEnforcementEnabled}
              onChange={(event) => setLimitEnforcementEnabled(event.target.checked)}
            />
            Enforce per-account request limits
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={freeErrorEnabled}
              onChange={(event) => setFreeErrorEnabled(event.target.checked)}
            />
            Throw explicit error when free accounts are exhausted
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoDisableFreeExhausted}
              onChange={(event) => setAutoDisableFreeExhausted(event.target.checked)}
            />
            Auto-disable free accounts when quota is exhausted
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoDisableOnLimitReached}
              onChange={(event) => setAutoDisableOnLimitReached(event.target.checked)}
            />
            Auto-disable accounts that hit custom limits
          </label>
        </div>

        <label className="text-xs text-gray-300 flex flex-col gap-1">
          Free exhausted error code
          <input
            value={freeErrorCode}
            onChange={(event) => setFreeErrorCode(event.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </label>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Traffic Shaping & Safety</h3>
            <p className="text-xs text-gray-400 mt-1">
              These controls shape outbound Copilot traffic. Conservative values
              reduce burstiness, but they do not guarantee compliance or prevent
              provider enforcement.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="text-gray-500">Active</div>
              <div className="text-white font-semibold">{trafficStats?.activeRequests ?? 0}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="text-gray-500">Queued</div>
              <div className="text-white font-semibold">{trafficStats?.queuedRequests ?? 0}</div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="text-gray-500">Next slot</div>
              <div className="text-white font-semibold">
                {formatNextSlot(trafficStats?.nextRequestNotBefore)}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-xs text-gray-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={trafficControlEnabled}
              onChange={(event) => setTrafficControlEnabled(event.target.checked)}
            />
            Enable global traffic shaping
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={queueEnabled}
              onChange={(event) => setQueueEnabled(event.target.checked)}
            />
            Queue requests instead of returning 429 when pacing blocks them
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Min delay between request starts (ms)
            <input
              value={minDelayMs}
              onChange={(event) => setMinDelayMs(event.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Extra random jitter (ms)
            <input
              value={delayJitterMs}
              onChange={(event) => setDelayJitterMs(event.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Max concurrent upstream requests
            <input
              value={maxConcurrentRequests}
              onChange={(event) => setMaxConcurrentRequests(event.target.value)}
              placeholder="empty = unlimited"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Max queued requests
            <input
              value={maxQueueSize}
              onChange={(event) => setMaxQueueSize(event.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Max queue wait (ms)
            <input
              value={maxQueueWaitMs}
              onChange={(event) => setMaxQueueWaitMs(event.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </label>
          <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400">
            Window counts now: minute {trafficStats?.minuteCount ?? 0}, hour{" "}
            {trafficStats?.hourCount ?? 0}, day {trafficStats?.dayCount ?? 0}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Global max requests/minute
            <input
              value={maxRequestsPerMinute}
              onChange={(event) => setMaxRequestsPerMinute(event.target.value)}
              placeholder="empty = unlimited"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Global max requests/hour
            <input
              value={maxRequestsPerHour}
              onChange={(event) => setMaxRequestsPerHour(event.target.value)}
              placeholder="empty = unlimited"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Global max requests/day
            <input
              value={maxRequestsPerDay}
              onChange={(event) => setMaxRequestsPerDay(event.target.value)}
              placeholder="empty = unlimited"
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <button
          onClick={saveRuntimeSettings}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Runtime Settings"}
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Change Admin Password</h3>
        <form onSubmit={handleChangePassword} className="flex gap-2">
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="New password"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={saving || !newPassword}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Update"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Environment Variables</h3>
        <div className="space-y-2 text-xs text-gray-400">
          <p>
            <code className="text-blue-300">API_KEY</code>,{" "}
            <code className="text-blue-300">API_KEYS</code>,{" "}
            <code className="text-blue-300">AUTH_API_KEYS</code>: Protect public API
            access
          </p>
          <p>
            <code className="text-blue-300">ADMIN_PASSWORD</code>,{" "}
            <code className="text-blue-300">JWT_SECRET</code>: Dashboard auth
          </p>
          <p>
            <code className="text-blue-300">DATABASE_URL</code>,{" "}
            <code className="text-blue-300">MYSQL_URL</code>,{" "}
            <code className="text-blue-300">MONGODB_URL</code>: Persistent account storage
          </p>
          <p>
            <code className="text-blue-300">CORS_ALLOWED_ORIGINS</code>: Restrict
            browser origins
          </p>
          <p>
            <code className="text-blue-300">GLOBAL_*</code>,{" "}
            <code className="text-blue-300">DEFAULT_MAX_REQUESTS_*</code>,{" "}
            <code className="text-blue-300">FREE_ACCOUNT_POLICY</code>: Runtime traffic
            and rotation overrides
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`rounded border px-3 py-2 text-sm ${
            message.startsWith("Error")
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-green-500/30 bg-green-500/10 text-green-300"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
