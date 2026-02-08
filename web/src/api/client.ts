const API_BASE = "/admin"

function getToken(): string | null {
  return localStorage.getItem("admin_token")
}

export function setToken(token: string) {
  localStorage.setItem("admin_token", token)
}

export function clearToken() {
  localStorage.removeItem("admin_token")
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    clearToken()
    window.location.href = "/dashboard/login"
    throw new Error("Unauthorized")
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<T>
}

// --- Auth ---
export async function login(password: string): Promise<string> {
  const result = await apiFetch<{ token: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  })
  setToken(result.token)
  return result.token
}

// --- Accounts ---
export interface Account {
  id: string
  label: string | null
  githubUsername: string | null
  accountType: string
  status: "active" | "rate_limited" | "dead" | "forbidden" | "disabled"
  statusMessage: string | null
  isPremium: boolean
  totalRequests: number
  lastUsedAt: string | null
  maxRequestsPerHour: number | null
  maxRequestsPerDay: number | null
  rotationWeight: number
  errorCode: string | null
  premiumRemaining: number | null
  premiumUnlimited: boolean | null
  hasCopilotToken: boolean
  modelCount: number
}

export async function fetchAccounts(): Promise<Account[]> {
  return apiFetch<Account[]>("/accounts")
}

export async function addAccountByToken(
  githubToken: string,
  label?: string,
  accountType?: string,
): Promise<Account> {
  return apiFetch<Account>("/accounts", {
    method: "POST",
    body: JSON.stringify({ githubToken, label, accountType }),
  })
}

export async function removeAccount(id: string): Promise<void> {
  await apiFetch(`/accounts/${id}`, { method: "DELETE" })
}

export interface UpdateAccountPayload {
  action?: "enable" | "disable" | "reset_counters"
  label?: string | null
  maxRequestsPerHour?: number | null
  maxRequestsPerDay?: number | null
  rotationWeight?: number
}

export async function updateAccount(
  id: string,
  payload: UpdateAccountPayload,
): Promise<Account> {
  return apiFetch<Account>(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export async function refreshAccountToken(id: string): Promise<void> {
  await apiFetch(`/accounts/${id}/refresh`, { method: "POST" })
}

export interface DeviceFlowStart {
  flowId: string
  userCode: string
  verificationUri: string
  expiresIn: number
}

export async function startDeviceFlow(
  label?: string,
  accountType?: string,
): Promise<DeviceFlowStart> {
  return apiFetch<DeviceFlowStart>("/accounts/device-flow/start", {
    method: "POST",
    body: JSON.stringify({ label, accountType }),
  })
}

export interface DeviceFlowPollResult {
  status?: string
  success?: boolean
  accountId?: string
  error?: string
  message?: string
}

export async function pollDeviceFlow(
  flowId: string,
): Promise<DeviceFlowPollResult> {
  return apiFetch<DeviceFlowPollResult>("/accounts/device-flow/poll", {
    method: "POST",
    body: JSON.stringify({ flowId }),
  })
}

export interface AccountUsage {
  quota_snapshots?: {
    premium_interactions?: QuotaDetail
    chat?: QuotaDetail
    completions?: QuotaDetail
  }
  copilot_plan?: string
  quota_reset_date?: string
}

interface QuotaDetail {
  entitlement: number
  remaining: number
  percent_remaining: number
  unlimited: boolean
}

export async function fetchAccountUsage(id: string): Promise<AccountUsage> {
  return apiFetch<AccountUsage>(`/accounts/${id}/usage`)
}

// --- Stats ---
export interface Stats {
  totalAccounts: number
  activeAccounts: number
  rateLimitedAccounts: number
  deadAccounts: number
  totalRequests: number
  freeAccounts?: number
  premiumAccounts?: number
  freeExhaustedAccounts?: number
  dataStore?: string
  rotationStrategy?: string
  freeAccountPolicy?: string
}

export async function fetchStats(): Promise<Stats> {
  return apiFetch<Stats>("/stats")
}

// --- Settings ---
export async function fetchSettings(): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>("/settings")
}

export async function updateSettings(
  settings: Record<string, unknown>,
): Promise<void> {
  await apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  })
}
