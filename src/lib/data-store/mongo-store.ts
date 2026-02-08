import { randomUUID } from "node:crypto"

import { MongoClient } from "mongodb"

import { normalizeNewStoredAccount, normalizeStoredAccount } from "./shared"
import type {
  DataStore,
  NewStoredAccount,
  RequestLogRecord,
  StoredAccount,
  StoredAccountPatch,
} from "./types"

const DEFAULT_DB_NAME = "copilot_api"

interface MongoAccountDocument {
  _id: string
  label: string | null
  githubToken: string
  copilotToken: string | null
  copilotTokenExpiresAt: Date | null
  accountType: string
  githubUsername: string | null
  status: string
  statusMessage: string | null
  statusUpdatedAt: Date | null
  isPremium: boolean
  totalRequests: number
  lastUsedAt: Date | null
  maxRequestsPerHour: number | null
  maxRequestsPerDay: number | null
  rotationWeight: number
  createdAt: Date
  updatedAt: Date
}

interface MongoRequestLogDocument {
  _id: string
  accountId: string
  endpoint: string
  model: string | null
  statusCode: number
  errorType: string | null
  durationMs: number
  requestedAt: Date
}

interface MongoSettingDocument {
  _id: string
  value: unknown
  updatedAt: Date
}

export class MongoDataStore implements DataStore {
  kind = "mongodb" as const

  private readonly mongodbUrl: string
  private readonly client: MongoClient
  private connected = false

  constructor(mongodbUrl: string) {
    this.mongodbUrl = mongodbUrl
    this.client = new MongoClient(this.mongodbUrl)
  }

  private get db() {
    const dbName = this.client.options.dbName ?? DEFAULT_DB_NAME
    return this.client.db(dbName)
  }

  private get accountsCollection() {
    return this.db.collection<MongoAccountDocument>("accounts")
  }

  private get requestLogsCollection() {
    return this.db.collection<MongoRequestLogDocument>("request_logs")
  }

  private get settingsCollection() {
    return this.db.collection<MongoSettingDocument>("settings")
  }

  async initialize(): Promise<void> {
    if (!this.connected) {
      await this.client.connect()
      this.connected = true
    }

    await this.accountsCollection.createIndex({ status: 1 })
    await this.accountsCollection.createIndex({ createdAt: 1 })
    await this.requestLogsCollection.createIndex({ accountId: 1 })
    await this.requestLogsCollection.createIndex({ requestedAt: 1 })
  }

  async listAccounts(): Promise<Array<StoredAccount>> {
    const rows = await this.accountsCollection
      .find({})
      .sort({ createdAt: 1 })
      .toArray()

    return rows.map((row) =>
      normalizeStoredAccount({
        id: row._id,
        label: row.label,
        githubToken: row.githubToken,
        copilotToken: row.copilotToken,
        copilotTokenExpiresAt: row.copilotTokenExpiresAt,
        accountType: row.accountType,
        githubUsername: row.githubUsername,
        status: row.status,
        statusMessage: row.statusMessage,
        statusUpdatedAt: row.statusUpdatedAt,
        isPremium: row.isPremium,
        totalRequests: row.totalRequests,
        lastUsedAt: row.lastUsedAt,
        maxRequestsPerHour: row.maxRequestsPerHour,
        maxRequestsPerDay: row.maxRequestsPerDay,
        rotationWeight: row.rotationWeight,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    )
  }

  async createAccount(input: NewStoredAccount): Promise<StoredAccount> {
    const normalized = normalizeNewStoredAccount(input)
    const now = new Date()
    const id = randomUUID()

    await this.accountsCollection.insertOne({
      _id: id,
      label: normalized.label ?? null,
      githubToken: normalized.githubToken,
      copilotToken: null,
      copilotTokenExpiresAt: null,
      accountType: normalized.accountType,
      githubUsername: normalized.githubUsername ?? null,
      status: normalized.status ?? "active",
      statusMessage: null,
      statusUpdatedAt: now,
      isPremium: normalized.isPremium ?? false,
      totalRequests: 0,
      lastUsedAt: null,
      maxRequestsPerHour: normalized.maxRequestsPerHour ?? null,
      maxRequestsPerDay: normalized.maxRequestsPerDay ?? null,
      rotationWeight: normalized.rotationWeight ?? 1,
      createdAt: now,
      updatedAt: now,
    })

    const row = await this.accountsCollection.findOne({ _id: id })
    if (!row) {
      throw new Error("Failed to create account")
    }

    return normalizeStoredAccount({
      id: row._id,
      label: row.label,
      githubToken: row.githubToken,
      copilotToken: row.copilotToken,
      copilotTokenExpiresAt: row.copilotTokenExpiresAt,
      accountType: row.accountType,
      githubUsername: row.githubUsername,
      status: row.status,
      statusMessage: row.statusMessage,
      statusUpdatedAt: row.statusUpdatedAt,
      isPremium: row.isPremium,
      totalRequests: row.totalRequests,
      lastUsedAt: row.lastUsedAt,
      maxRequestsPerHour: row.maxRequestsPerHour,
      maxRequestsPerDay: row.maxRequestsPerDay,
      rotationWeight: row.rotationWeight,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  async updateAccount(id: string, patch: StoredAccountPatch): Promise<void> {
    const setPayload: Record<string, unknown> = {}
    const incPayload: Record<string, number> = {}

    if (patch.label !== undefined) setPayload.label = patch.label
    if (patch.githubToken !== undefined) setPayload.githubToken = patch.githubToken
    if (patch.copilotToken !== undefined) setPayload.copilotToken = patch.copilotToken
    if (patch.copilotTokenExpiresAt !== undefined) {
      setPayload.copilotTokenExpiresAt = patch.copilotTokenExpiresAt
    }
    if (patch.accountType !== undefined) setPayload.accountType = patch.accountType
    if (patch.githubUsername !== undefined) {
      setPayload.githubUsername = patch.githubUsername
    }
    if (patch.status !== undefined) setPayload.status = patch.status
    if (patch.statusMessage !== undefined) {
      setPayload.statusMessage = patch.statusMessage
    }
    if (patch.statusUpdatedAt !== undefined) {
      setPayload.statusUpdatedAt = patch.statusUpdatedAt
    }
    if (patch.isPremium !== undefined) setPayload.isPremium = patch.isPremium
    if (patch.totalRequests !== undefined) setPayload.totalRequests = patch.totalRequests
    if (patch.lastUsedAt !== undefined) setPayload.lastUsedAt = patch.lastUsedAt
    if (patch.maxRequestsPerHour !== undefined) {
      setPayload.maxRequestsPerHour = patch.maxRequestsPerHour
    }
    if (patch.maxRequestsPerDay !== undefined) {
      setPayload.maxRequestsPerDay = patch.maxRequestsPerDay
    }
    if (patch.rotationWeight !== undefined) {
      setPayload.rotationWeight = patch.rotationWeight
    }

    if (patch.totalRequestsIncrement !== undefined) {
      incPayload.totalRequests = patch.totalRequestsIncrement
    }

    setPayload.updatedAt = patch.updatedAt ?? new Date()

    const hasSet = Object.keys(setPayload).length > 0
    const hasInc = Object.keys(incPayload).length > 0
    if (!hasSet && !hasInc) return

    await this.accountsCollection.updateOne(
      { _id: id },
      {
        ...(hasSet ? { $set: setPayload } : {}),
        ...(hasInc ? { $inc: incPayload } : {}),
      },
    )
  }

  async deleteAccount(id: string): Promise<void> {
    await this.accountsCollection.deleteOne({ _id: id })
    await this.requestLogsCollection.deleteMany({ accountId: id })
  }

  async insertRequestLog(log: RequestLogRecord): Promise<void> {
    await this.requestLogsCollection.insertOne({
      _id: randomUUID(),
      accountId: log.accountId,
      endpoint: log.endpoint,
      model: log.model,
      statusCode: log.statusCode,
      errorType: log.errorType,
      durationMs: log.durationMs,
      requestedAt: new Date(),
    })
  }

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = await this.settingsCollection.find({}).toArray()
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      if (typeof row._id === "string") {
        result[row._id] = row.value
      }
    }
    return result
  }

  async upsertSettings(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.settingsCollection.updateOne(
        { _id: key },
        {
          $set: {
            value,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      )
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return
    await this.client.close()
    this.connected = false
  }
}
