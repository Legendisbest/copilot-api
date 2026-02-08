import consola from "consola"

import { MemoryDataStore } from "./memory-store"
import { MongoDataStore } from "./mongo-store"
import { MySqlDataStore } from "./mysql-store"
import { PostgresDataStore } from "./postgres-store"
import type { DataStore, DataStoreInitOptions, DataStoreKind } from "./types"

let store: DataStore = new MemoryDataStore()
let initialized = false

const inferClientFromUrl = (url: string | undefined): DataStoreKind | null => {
  if (!url) return null
  const lower = url.toLowerCase()
  if (lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://")) {
    return "mongodb"
  }
  if (lower.startsWith("mysql://") || lower.startsWith("mariadb://")) {
    return "mysql"
  }
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) {
    return "postgres"
  }
  return null
}

const normalizeClient = (client: string | undefined): DataStoreKind | null => {
  if (!client) return null
  const lower = client.toLowerCase()
  if (lower === "postgres" || lower === "postgresql") return "postgres"
  if (lower === "mysql") return "mysql"
  if (lower === "mongodb" || lower === "mongo") return "mongodb"
  if (lower === "memory") return "memory"
  return null
}

const resolveStoreConfig = (
  options?: DataStoreInitOptions,
): {
  kind: DataStoreKind
  url?: string
} => {
  const mysqlUrl = options?.mysqlUrl ?? process.env.MYSQL_URL
  const mongodbUrl = options?.mongodbUrl ?? process.env.MONGODB_URL
  const databaseUrl = options?.databaseUrl ?? process.env.DATABASE_URL
  const requestedClient = normalizeClient(options?.client ?? process.env.DB_CLIENT)

  if (requestedClient === "memory") {
    return { kind: "memory" }
  }

  if (requestedClient === "mysql") {
    return mysqlUrl || databaseUrl ? { kind: "mysql", url: mysqlUrl ?? databaseUrl } : { kind: "memory" }
  }

  if (requestedClient === "mongodb") {
    return mongodbUrl || databaseUrl ?
        { kind: "mongodb", url: mongodbUrl ?? databaseUrl }
      : { kind: "memory" }
  }

  if (requestedClient === "postgres") {
    return databaseUrl ? { kind: "postgres", url: databaseUrl } : { kind: "memory" }
  }

  const inferredFromExplicitUrls =
    inferClientFromUrl(mysqlUrl)
    ?? inferClientFromUrl(mongodbUrl)
    ?? inferClientFromUrl(databaseUrl)

  if (inferredFromExplicitUrls === "mysql") {
    return { kind: "mysql", url: mysqlUrl ?? databaseUrl }
  }

  if (inferredFromExplicitUrls === "mongodb") {
    return { kind: "mongodb", url: mongodbUrl ?? databaseUrl }
  }

  if (inferredFromExplicitUrls === "postgres") {
    return { kind: "postgres", url: databaseUrl }
  }

  return { kind: "memory" }
}

export const initDataStore = async (
  options?: DataStoreInitOptions,
): Promise<DataStore> => {
  if (initialized) {
    return store
  }

  const { kind, url } = resolveStoreConfig(options)
  if (kind === "mysql" && url) {
    store = new MySqlDataStore(url)
  } else if (kind === "mongodb" && url) {
    store = new MongoDataStore(url)
  } else if (kind === "postgres" && url) {
    store = new PostgresDataStore(url)
  } else {
    store = new MemoryDataStore()
  }

  await store.initialize()
  initialized = true

  consola.info(`Data store initialized: ${store.kind}`)
  return store
}

export const getDataStore = (): DataStore => store

export const getDataStoreKind = (): DataStoreKind => store.kind

export const isPersistentDataStore = (): boolean => store.kind !== "memory"

