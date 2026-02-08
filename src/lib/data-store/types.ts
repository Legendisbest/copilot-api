export type DataStoreKind = "memory" | "postgres" | "mysql" | "mongodb"

export type AccountStatus =
  | "active"
  | "rate_limited"
  | "dead"
  | "forbidden"
  | "disabled"

export type AccountType = "individual" | "business" | "enterprise"

export interface StoredAccount {
  id: string
  label: string | null
  githubToken: string
  copilotToken: string | null
  copilotTokenExpiresAt: Date | null
  accountType: AccountType
  githubUsername: string | null
  status: AccountStatus
  statusMessage: string | null
  statusUpdatedAt: Date | null
  isPremium: boolean
  totalRequests: number
  lastUsedAt: Date | null
  maxRequestsPerHour: number | null
  maxRequestsPerDay: number | null
  rotationWeight: number
  createdAt: Date | null
  updatedAt: Date | null
}

export interface NewStoredAccount {
  githubToken: string
  label: string | null
  accountType: AccountType
  githubUsername: string | null
  status?: AccountStatus
  isPremium?: boolean
  maxRequestsPerHour?: number | null
  maxRequestsPerDay?: number | null
  rotationWeight?: number
}

export interface StoredAccountPatch {
  label?: string | null
  githubToken?: string
  copilotToken?: string | null
  copilotTokenExpiresAt?: Date | null
  accountType?: AccountType
  githubUsername?: string | null
  status?: AccountStatus
  statusMessage?: string | null
  statusUpdatedAt?: Date | null
  isPremium?: boolean
  totalRequests?: number
  totalRequestsIncrement?: number
  lastUsedAt?: Date | null
  maxRequestsPerHour?: number | null
  maxRequestsPerDay?: number | null
  rotationWeight?: number
  updatedAt?: Date
}

export interface RequestLogRecord {
  accountId: string
  endpoint: string
  model: string | null
  statusCode: number
  errorType: string | null
  durationMs: number
}

export interface DataStore {
  kind: DataStoreKind
  initialize(): Promise<void>
  listAccounts(): Promise<Array<StoredAccount>>
  createAccount(input: NewStoredAccount): Promise<StoredAccount>
  updateAccount(id: string, patch: StoredAccountPatch): Promise<void>
  deleteAccount(id: string): Promise<void>
  insertRequestLog(log: RequestLogRecord): Promise<void>
  getSettings(): Promise<Record<string, unknown>>
  upsertSettings(values: Record<string, unknown>): Promise<void>
  close?(): Promise<void>
}

export interface DataStoreInitOptions {
  client?: string
  databaseUrl?: string
  mysqlUrl?: string
  mongodbUrl?: string
}

export const isSqlClient = (
  client: DataStoreKind,
): client is "postgres" | "mysql" => {
  return client === "postgres" || client === "mysql"
}

export const sanitizeRotationWeight = (weight: number | null | undefined) => {
  if (!weight || Number.isNaN(weight) || weight < 1) {
    return 1
  }
  return Math.max(1, Math.floor(weight))
}

