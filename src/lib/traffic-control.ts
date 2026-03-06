import consola from "consola"

import { getDataStore } from "./data-store"
import { HTTPError } from "./error"

interface WindowState {
  startedAt: number
  count: number
}

interface PendingLeaseRequest {
  routeLabel: string
  deadlineAt: number
  resolve: (lease: TrafficLease) => void
  reject: (error: unknown) => void
}

interface LegacyTrafficControlOverrides {
  minDelayMs?: number
  queueEnabled?: boolean
}

interface BlockingCondition {
  code: string
  message: string
  retryAfterMs: number | null
}

export interface TrafficControlSettings {
  enabled: boolean
  minDelayMs: number
  delayJitterMs: number
  maxConcurrentRequests: number | null
  queueEnabled: boolean
  maxQueueSize: number
  maxQueueWaitMs: number
  maxRequestsPerMinute: number | null
  maxRequestsPerHour: number | null
  maxRequestsPerDay: number | null
}

export interface TrafficControlStats {
  activeRequests: number
  queuedRequests: number
  nextRequestNotBefore: string | null
  minuteCount: number
  hourCount: number
  dayCount: number
}

export interface TrafficLease {
  release(): void
}

export const DEFAULT_TRAFFIC_CONTROL_SETTINGS: TrafficControlSettings = {
  enabled: true,
  minDelayMs: 0,
  delayJitterMs: 0,
  maxConcurrentRequests: null,
  queueEnabled: false,
  maxQueueSize: 100,
  maxQueueWaitMs: 15 * 60 * 1000,
  maxRequestsPerMinute: null,
  maxRequestsPerHour: null,
  maxRequestsPerDay: null,
}

const createWindowState = (now: number): WindowState => ({
  startedAt: now,
  count: 0,
})

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true" || normalized === "1") return true
    if (normalized === "false" || normalized === "0") return false
  }
  return fallback
}

const parseIntegerLike = (value: unknown): number | null => {
  if (typeof value === "number") {
    return value
  }

  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  return Number.parseInt(trimmed, 10)
}

const parseNonNegativeInt = (value: unknown, fallback: number): number => {
  const parsed = parseIntegerLike(value)
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.floor(parsed)
}

const parsePositiveInt = (
  value: unknown,
  fallback: number | null,
): number | null => {
  if (value === null || value === undefined || value === "") {
    return fallback
  }
  const parsed = parseIntegerLike(value)
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.floor(parsed)
}

const getSettingValue = ({
  env,
  values,
  envKey,
  settingKey,
}: {
  env: NodeJS.ProcessEnv
  values: Record<string, unknown>
  envKey: string
  settingKey: string
}): unknown => env[envKey] ?? values[settingKey]

const buildBaseTrafficControlSettings = (
  env: NodeJS.ProcessEnv,
  values: Record<string, unknown>,
): TrafficControlSettings => ({
  enabled: parseBoolean(
    getSettingValue({
      env,
      values,
      envKey: "TRAFFIC_CONTROL_ENABLED",
      settingKey: "traffic_control_enabled",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.enabled,
  ),
  minDelayMs: parseNonNegativeInt(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_MIN_DELAY_MS",
      settingKey: "global_min_delay_ms",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.minDelayMs,
  ),
  delayJitterMs: parseNonNegativeInt(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_DELAY_JITTER_MS",
      settingKey: "global_delay_jitter_ms",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.delayJitterMs,
  ),
  maxConcurrentRequests: parsePositiveInt(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_MAX_CONCURRENT_REQUESTS",
      settingKey: "global_max_concurrent_requests",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxConcurrentRequests,
  ),
  queueEnabled: parseBoolean(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_QUEUE_ENABLED",
      settingKey: "global_queue_enabled",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.queueEnabled,
  ),
  maxQueueSize:
    parsePositiveInt(
      getSettingValue({
        env,
        values,
        envKey: "GLOBAL_MAX_QUEUE_SIZE",
        settingKey: "global_max_queue_size",
      }),
      DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxQueueSize,
    ) ?? DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxQueueSize,
  maxQueueWaitMs:
    parsePositiveInt(
      getSettingValue({
        env,
        values,
        envKey: "GLOBAL_MAX_QUEUE_WAIT_MS",
        settingKey: "global_max_queue_wait_ms",
      }),
      DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxQueueWaitMs,
    ) ?? DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxQueueWaitMs,
  maxRequestsPerMinute: parsePositiveInt(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_MAX_REQUESTS_PER_MINUTE",
      settingKey: "global_max_requests_per_minute",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxRequestsPerMinute,
  ),
  maxRequestsPerHour: parsePositiveInt(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_MAX_REQUESTS_PER_HOUR",
      settingKey: "global_max_requests_per_hour",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxRequestsPerHour,
  ),
  maxRequestsPerDay: parsePositiveInt(
    getSettingValue({
      env,
      values,
      envKey: "GLOBAL_MAX_REQUESTS_PER_DAY",
      settingKey: "global_max_requests_per_day",
    }),
    DEFAULT_TRAFFIC_CONTROL_SETTINGS.maxRequestsPerDay,
  ),
})

const applyLegacyTrafficControlOverrides = (
  settings: TrafficControlSettings,
  legacy?: LegacyTrafficControlOverrides,
): TrafficControlSettings => {
  if (legacy?.minDelayMs !== undefined) {
    settings.enabled = true
    settings.minDelayMs = Math.max(0, Math.floor(legacy.minDelayMs))
  }

  if (legacy?.queueEnabled !== undefined) {
    settings.queueEnabled = legacy.queueEnabled
  }

  return settings
}

export const buildTrafficControlSettings = (
  values: Record<string, unknown>,
  options?: {
    env?: NodeJS.ProcessEnv
    legacy?: LegacyTrafficControlOverrides
  },
): TrafficControlSettings => {
  const env = options?.env ?? process.env
  return applyLegacyTrafficControlOverrides(
    buildBaseTrafficControlSettings(env, values),
    options?.legacy,
  )
}

const createTrafficControlError = (
  routeLabel: string,
  condition: BlockingCondition,
  details?: Record<string, unknown> | TrafficControlStats,
): HTTPError => {
  const retryAfterSeconds =
    condition.retryAfterMs === null ?
      undefined
    : Math.max(1, Math.ceil(condition.retryAfterMs / 1000))
  const headers =
    retryAfterSeconds === undefined ? undefined : (
      { "Retry-After": String(retryAfterSeconds) }
    )

  return new HTTPError(
    condition.message,
    Response.json(
      {
        error: {
          type: "rate_limit_error",
          code: condition.code,
          message: condition.message,
          details: {
            route: routeLabel,
            retry_after_ms: condition.retryAfterMs,
            ...details,
          },
        },
      },
      {
        status: 429,
        headers,
      },
    ),
  )
}

export const wrapAsyncIterableWithLease = async function* <T>(
  iterable: AsyncIterable<T>,
  lease: TrafficLease,
): AsyncGenerator<T, void, unknown> {
  try {
    for await (const item of iterable) {
      yield item
    }
  } finally {
    lease.release()
  }
}

export class TrafficControlManager {
  private settings: TrafficControlSettings = DEFAULT_TRAFFIC_CONTROL_SETTINGS
  private storedValues: Record<string, unknown> = {}
  private legacyOverrides: LegacyTrafficControlOverrides = {}
  private activeRequests = 0
  private nextStartAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly queue: Array<PendingLeaseRequest> = []
  private readonly windows = {
    minute: createWindowState(Date.now()),
    hour: createWindowState(Date.now()),
    day: createWindowState(Date.now()),
  }

  async reloadSettings(): Promise<void> {
    try {
      this.storedValues = await getDataStore().getSettings()
      this.applyCurrentSettings()
    } catch (error) {
      consola.warn(
        "Failed to load traffic-control settings, using defaults",
        error,
      )
      this.storedValues = {}
      this.applyCurrentSettings()
    }
  }

  setLegacyRateLimit(rateLimitSeconds?: number, wait: boolean = false): void {
    this.legacyOverrides =
      rateLimitSeconds === undefined ?
        {}
      : {
          minDelayMs: Math.max(0, Math.floor(rateLimitSeconds * 1000)),
          queueEnabled: wait,
        }
    this.applyCurrentSettings()
  }

  getSettings(): TrafficControlSettings {
    return { ...this.settings }
  }

  getStats(): TrafficControlStats {
    const now = Date.now()
    this.resetWindowsIfNeeded(now)

    return {
      activeRequests: this.activeRequests,
      queuedRequests: this.queue.length,
      nextRequestNotBefore:
        this.nextStartAt > now ?
          new Date(this.nextStartAt).toISOString()
        : null,
      minuteCount: this.windows.minute.count,
      hourCount: this.windows.hour.count,
      dayCount: this.windows.day.count,
    }
  }

  setSettingsForTest(settings: Partial<TrafficControlSettings>): void {
    this.storedValues = {}
    this.legacyOverrides = {}
    this.clearTimer()
    this.activeRequests = 0
    this.nextStartAt = 0
    this.queue.length = 0
    const now = Date.now()
    this.windows.minute = createWindowState(now)
    this.windows.hour = createWindowState(now)
    this.windows.day = createWindowState(now)
    this.settings = {
      ...DEFAULT_TRAFFIC_CONTROL_SETTINGS,
      ...settings,
    }
  }

  async acquire(routeLabel: string): Promise<TrafficLease> {
    if (!this.settings.enabled) {
      return { release: () => undefined }
    }

    const now = Date.now()
    this.resetWindowsIfNeeded(now)

    if (this.queue.length === 0) {
      const blocking = this.getBlockingCondition(now)
      if (!blocking) {
        return this.startLease(now)
      }

      if (!this.settings.queueEnabled) {
        throw createTrafficControlError(routeLabel, blocking, this.getStats())
      }
    } else if (!this.settings.queueEnabled) {
      throw createTrafficControlError(
        routeLabel,
        {
          code: "TRAFFIC_QUEUE_DISABLED",
          message:
            "Global traffic shaping rejected the request because another request is already waiting.",
          retryAfterMs: null,
        },
        this.getStats(),
      )
    }

    if (this.queue.length >= this.settings.maxQueueSize) {
      throw createTrafficControlError(
        routeLabel,
        {
          code: "TRAFFIC_QUEUE_FULL",
          message:
            "Global traffic shaping queue is full. Reduce traffic or raise the queue size.",
          retryAfterMs: null,
        },
        this.getStats(),
      )
    }

    return await new Promise<TrafficLease>((resolve, reject) => {
      const pending: PendingLeaseRequest = {
        routeLabel,
        deadlineAt: Date.now() + this.settings.maxQueueWaitMs,
        resolve,
        reject,
      }
      this.queue.push(pending)
      this.pumpQueue()
    })
  }

  private applyCurrentSettings(): void {
    this.settings = buildTrafficControlSettings(this.storedValues, {
      legacy: this.legacyOverrides,
    })
    this.pumpQueue()
  }

  private startLease(now: number): TrafficLease {
    this.activeRequests += 1
    this.bumpWindows(now)
    this.nextStartAt = now + this.settings.minDelayMs + this.getDelayJitterMs()

    let released = false

    return {
      release: () => {
        if (released) return
        released = true
        this.activeRequests = Math.max(0, this.activeRequests - 1)
        setTimeout(() => this.pumpQueue(), 0)
      },
    }
  }

  private getDelayJitterMs(): number {
    if (this.settings.delayJitterMs <= 0) return 0
    return Math.floor(Math.random() * (this.settings.delayJitterMs + 1))
  }

  private pumpQueue(): void {
    this.clearTimer()

    while (this.queue.length > 0) {
      const now = Date.now()
      this.resetWindowsIfNeeded(now)

      const pending = this.queue[0]
      if (pending.deadlineAt <= now) {
        this.queue.shift()
        pending.reject(
          createTrafficControlError(
            pending.routeLabel,
            {
              code: "TRAFFIC_QUEUE_TIMEOUT",
              message:
                "Global traffic shaping queue timed out before the request could start.",
              retryAfterMs: null,
            },
            this.getStats(),
          ),
        )
        continue
      }

      const blocking = this.getBlockingCondition(now)
      if (blocking) {
        const wakeAt =
          blocking.retryAfterMs === null ?
            pending.deadlineAt
          : Math.min(now + blocking.retryAfterMs, pending.deadlineAt)
        this.schedulePump(wakeAt)
        return
      }

      this.queue.shift()
      pending.resolve(this.startLease(now))
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private schedulePump(at: number): void {
    const delay = Math.max(0, at - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      this.pumpQueue()
    }, delay)
  }

  private getBlockingCondition(now: number): BlockingCondition | null {
    const { maxConcurrentRequests } = this.settings
    if (
      maxConcurrentRequests !== null
      && this.activeRequests >= maxConcurrentRequests
    ) {
      return {
        code: "MAX_CONCURRENT_REQUESTS",
        message:
          "Global traffic shaping rejected the request because the max concurrent request limit was reached.",
        retryAfterMs: null,
      }
    }

    if (this.nextStartAt > now) {
      return {
        code: "MIN_DELAY_NOT_ELAPSED",
        message:
          "Global traffic shaping rejected the request because the minimum delay between requests has not elapsed.",
        retryAfterMs: this.nextStartAt - now,
      }
    }

    return this.getWindowBlockingCondition(now)
  }

  private getWindowBlockingCondition(now: number): BlockingCondition | null {
    const exceededResets: Array<number> = []
    const exceededCodes: Array<string> = []

    if (
      this.settings.maxRequestsPerMinute !== null
      && this.windows.minute.count >= this.settings.maxRequestsPerMinute
    ) {
      exceededResets.push(this.windows.minute.startedAt + 60_000)
      exceededCodes.push("GLOBAL_MINUTE_LIMIT_REACHED")
    }

    if (
      this.settings.maxRequestsPerHour !== null
      && this.windows.hour.count >= this.settings.maxRequestsPerHour
    ) {
      exceededResets.push(this.windows.hour.startedAt + 60 * 60 * 1000)
      exceededCodes.push("GLOBAL_HOUR_LIMIT_REACHED")
    }

    if (
      this.settings.maxRequestsPerDay !== null
      && this.windows.day.count >= this.settings.maxRequestsPerDay
    ) {
      exceededResets.push(getNextUtcMidnightMs(now))
      exceededCodes.push("GLOBAL_DAY_LIMIT_REACHED")
    }

    if (exceededResets.length === 0) {
      return null
    }

    const retryAfterMs = Math.max(...exceededResets) - now

    return {
      code: exceededCodes.join(","),
      message:
        "Global traffic shaping rejected the request because the configured request window limit was reached.",
      retryAfterMs: Math.max(0, retryAfterMs),
    }
  }

  private bumpWindows(now: number): void {
    this.resetWindowsIfNeeded(now)
    this.windows.minute.count += 1
    this.windows.hour.count += 1
    this.windows.day.count += 1
  }

  private resetWindowsIfNeeded(now: number): void {
    if (now - this.windows.minute.startedAt >= 60_000) {
      this.windows.minute.startedAt = now
      this.windows.minute.count = 0
    }

    if (now - this.windows.hour.startedAt >= 60 * 60 * 1000) {
      this.windows.hour.startedAt = now
      this.windows.hour.count = 0
    }

    const dayStart = new Date(this.windows.day.startedAt)
    const nowDate = new Date(now)
    const isSameUtcDay =
      dayStart.getUTCFullYear() === nowDate.getUTCFullYear()
      && dayStart.getUTCMonth() === nowDate.getUTCMonth()
      && dayStart.getUTCDate() === nowDate.getUTCDate()

    if (!isSameUtcDay) {
      this.windows.day.startedAt = now
      this.windows.day.count = 0
    }
  }
}

const getNextUtcMidnightMs = (now: number): number => {
  const current = new Date(now)
  return Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1,
  )
}

export const trafficControlManager = new TrafficControlManager()
