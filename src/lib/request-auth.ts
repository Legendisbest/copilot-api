import type { Context, MiddlewareHandler } from "hono"

import consola from "consola"
import { timingSafeEqual } from "node:crypto"

import { getConfig } from "./config"

interface AuthMiddlewareOptions {
  getApiKeys?: () => Array<string>
  allowUnauthenticatedPaths?: Array<string>
  allowUnauthenticatedPathPrefixes?: Array<string>
  allowOptionsBypass?: boolean
}

export function normalizeApiKeys(apiKeys: unknown): Array<string> {
  if (!Array.isArray(apiKeys)) {
    if (apiKeys !== undefined) {
      consola.warn("Invalid auth.apiKeys config. Expected an array of strings.")
    }
    return []
  }

  const normalizedKeys = apiKeys
    .filter((key): key is string => typeof key === "string")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)

  if (normalizedKeys.length !== apiKeys.length) {
    consola.warn(
      "Invalid auth.apiKeys entries found. Only non-empty strings are allowed.",
    )
  }

  return [...new Set(normalizedKeys)]
}

export function parseApiKeysFromEnv(raw: string | undefined): Array<string> {
  if (!raw) return []
  const normalized = raw.replaceAll("\n", ",")
  const keys = normalized
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
  return [...new Set(keys)]
}

export function getConfiguredApiKeys(): Array<string> {
  const config = getConfig()
  const configApiKeys = normalizeApiKeys(config.auth?.apiKeys)
  const envApiKeys = [
    ...parseApiKeysFromEnv(process.env.AUTH_API_KEYS),
    ...parseApiKeysFromEnv(process.env.API_KEYS),
  ]
  const singleEnvApiKey = parseApiKeysFromEnv(process.env.API_KEY)
  return [...new Set([...configApiKeys, ...envApiKeys, ...singleEnvApiKey])]
}

export function extractRequestApiKey(c: Context): string | null {
  const xApiKey = c.req.header("x-api-key")?.trim()
  if (xApiKey) {
    return xApiKey
  }

  const authorization = c.req.header("authorization")
  if (!authorization) {
    return null
  }

  const [scheme, ...rest] = authorization.trim().split(/\s+/)
  if (scheme.toLowerCase() !== "bearer") {
    return null
  }

  const bearerToken = rest.join(" ").trim()
  return bearerToken || null
}

function createUnauthorizedResponse(c: Context): Response {
  c.header("WWW-Authenticate", 'Bearer realm="copilot-api"')
  return c.json(
    {
      error: {
        message: "Unauthorized",
        type: "authentication_error",
      },
    },
    401,
  )
}

function doesPathMatchPrefix(path: string, prefix: string): boolean {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix
  if (normalizedPrefix.length === 0) return false
  if (path === normalizedPrefix) return true
  return path.startsWith(`${normalizedPrefix}/`)
}

function isAuthenticatedRequest(
  requestApiKey: string,
  apiKeys: Array<string>,
): boolean {
  const requestBuffer = Buffer.from(requestApiKey)
  return apiKeys.some((apiKey) => {
    const keyBuffer = Buffer.from(apiKey)
    if (keyBuffer.length !== requestBuffer.length) return false
    return timingSafeEqual(keyBuffer, requestBuffer)
  })
}

export function createAuthMiddleware(
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler {
  const getApiKeys = options.getApiKeys ?? getConfiguredApiKeys
  const allowUnauthenticatedPaths = options.allowUnauthenticatedPaths ?? [
    "/",
    "/health",
    "/favicon.ico",
  ]
  const allowUnauthenticatedPathPrefixes =
    options.allowUnauthenticatedPathPrefixes ?? [
      "/dashboard",
      "/assets",
      "/admin",
    ]
  const allowOptionsBypass = options.allowOptionsBypass ?? true

  return async (c, next) => {
    if (allowOptionsBypass && c.req.method === "OPTIONS") {
      return next()
    }

    if (allowUnauthenticatedPaths.includes(c.req.path)) {
      return next()
    }

    if (
      allowUnauthenticatedPathPrefixes.some((prefix) =>
        doesPathMatchPrefix(c.req.path, prefix),
      )
    ) {
      return next()
    }

    const apiKeys = getApiKeys()
    if (apiKeys.length === 0) {
      return next()
    }

    const requestApiKey = extractRequestApiKey(c)
    if (!requestApiKey || !isAuthenticatedRequest(requestApiKey, apiKeys)) {
      return createUnauthorizedResponse(c)
    }

    return next()
  }
}
