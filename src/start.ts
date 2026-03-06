#!/usr/bin/env node

import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import fs from "node:fs/promises"
import { serve, type ServerHandler } from "srvx"
import invariant from "tiny-invariant"

import { accountManager } from "./lib/account-manager"
import { mergeConfigWithDefaults } from "./lib/config"
import {
  getDataStoreKind,
  initDataStore,
  isPersistentDataStore,
} from "./lib/data-store"
import { ensurePaths, PATHS } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { generateEnvScript } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"

interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  showToken: boolean
  proxyEnv: boolean
  dbClient?: string
  databaseUrl?: string
  mysqlUrl?: string
  mongodbUrl?: string
  adminPassword?: string
}

const DEFAULT_PORT = 8080

function parsePortOrThrow(rawPort: string): number {
  const normalizedPort = rawPort.trim()
  if (!/^\d+$/.test(normalizedPort)) {
    throw new Error(
      `Invalid port "${rawPort}". Expected an integer between 1 and 65535.`,
    )
  }

  const port = Number(normalizedPort)
  if (port < 1 || port > 65535) {
    throw new Error(
      `Invalid port "${rawPort}". Expected an integer between 1 and 65535.`,
    )
  }
  return port
}

async function tryReadLegacyGithubToken(): Promise<string | null> {
  try {
    const token = await fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")
    return token.trim() || null
  } catch {
    return null
  }
}

async function setupMultiAccountMode(
  options: RunServerOptions,
  isHeadlessRuntime: boolean,
): Promise<void> {
  consola.info(`Multi-account mode enabled with ${getDataStoreKind()} backend`)
  await accountManager.initialize()

  if (accountManager.getAllAccounts().length === 0) {
    const legacyToken = await tryReadLegacyGithubToken()
    if (legacyToken) {
      consola.info("Migrating legacy single-account token to data store...")
      try {
        await accountManager.addAccount(
          legacyToken,
          "migrated-account",
          options.accountType,
        )
      } catch (error) {
        consola.error("Failed to migrate legacy token:", error)
      }
    }
  }

  if (accountManager.getAllAccounts().length === 0 && options.githubToken) {
    consola.info("Adding account from CLI --github-token...")
    try {
      await accountManager.addAccount(
        options.githubToken,
        "cli-account",
        options.accountType,
      )
    } catch (error) {
      consola.error("Failed to add CLI token account:", error)
    }
  }

  if (accountManager.getAllAccounts().length === 0) {
    if (isHeadlessRuntime) {
      consola.warn(
        "No accounts found in persistent store and runtime is non-interactive. "
          + "Starting server without accounts. Add accounts via /admin or set GH_TOKEN.",
      )
    } else {
      consola.info(
        "No accounts found. Starting device flow to add first account...",
      )
      const { getDeviceCode } = await import(
        "./services/github/get-device-code"
      )
      const { pollAccessToken } = await import(
        "./services/github/poll-access-token"
      )

      const deviceCode = await getDeviceCode()
      consola.info(
        `Please enter the code "${deviceCode.user_code}" in ${deviceCode.verification_uri}`,
      )
      const token = await pollAccessToken(deviceCode)
      await accountManager.addAccount(
        token,
        "initial-account",
        options.accountType,
      )
    }
  }

  const allAccounts = accountManager.getAllAccounts()
  const activeAccounts = allAccounts.filter((a) => a.status === "active")
  consola.info(
    `Accounts: ${activeAccounts.length} active / ${allAccounts.length} total`,
  )

  const firstActiveModels = activeAccounts.at(0)?.models
  if (firstActiveModels) {
    consola.info(
      `Available models: \n${firstActiveModels.data.map((model) => `- ${model.id}`).join("\n")}`,
    )
    if (!state.models) {
      state.models = firstActiveModels
    }
  }
}

async function setupSingleAccountMode(
  options: RunServerOptions,
): Promise<void> {
  consola.warn("No database configured. Running in single-account mode.")

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
  } else {
    await setupGitHubToken()
  }

  await setupCopilotToken()
  await cacheModels()

  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )
}

async function generateClaudeCodeCommand(serverUrl: string): Promise<void> {
  invariant(state.models, "Models should be loaded by now")

  const selectedModel = await consola.prompt(
    "Select a model to use with Claude Code",
    {
      type: "select",
      options: state.models.data.map((model) => model.id),
    },
  )

  const selectedSmallModel = await consola.prompt(
    "Select a small model to use with Claude Code",
    {
      type: "select",
      options: state.models.data.map((model) => model.id),
    },
  )

  const command = generateEnvScript(
    {
      ANTHROPIC_BASE_URL: serverUrl,
      ANTHROPIC_AUTH_TOKEN: "dummy",
      ANTHROPIC_MODEL: selectedModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
      ANTHROPIC_SMALL_FAST_MODEL: selectedSmallModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedSmallModel,
      DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    "claude",
  )

  try {
    clipboard.writeSync(command)
    consola.success("Copied Claude Code command to clipboard!")
  } catch {
    consola.warn(
      "Failed to copy to clipboard. Here is the Claude Code command:",
    )
    consola.log(command)
  }
}

export async function runServer(options: RunServerOptions): Promise<void> {
  mergeConfigWithDefaults()

  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  state.verbose = options.verbose
  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken

  if (options.adminPassword) {
    process.env.ADMIN_PASSWORD = options.adminPassword
  }

  await ensurePaths()
  await cacheVSCodeVersion()

  await initDataStore({
    client: options.dbClient,
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
    mysqlUrl: options.mysqlUrl ?? process.env.MYSQL_URL,
    mongodbUrl: options.mongodbUrl ?? process.env.MONGODB_URL,
  })

  const isHeadlessRuntime =
    !process.stdin.isTTY
    || process.env.RAILWAY_ENVIRONMENT !== undefined
    || process.env.CI !== undefined

  await (isPersistentDataStore() ?
    setupMultiAccountMode(options, isHeadlessRuntime)
  : setupSingleAccountMode(options))

  const serverUrl = `http://localhost:${options.port}`
  const railwayDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.RAILWAY_STATIC_URL
  let publicServerUrl = serverUrl
  if (railwayDomain) {
    publicServerUrl =
      /^https?:\/\//.test(railwayDomain) ? railwayDomain : (
        `https://${railwayDomain}`
      )
  }

  if (options.claudeCode) {
    await generateClaudeCodeCommand(serverUrl)
  }

  const startupLinks = [
    `Usage JSON: ${publicServerUrl}/usage`,
    `Usage Viewer: ${serverUrl}/usage-viewer?endpoint=${serverUrl}/usage`,
    `Dashboard: ${publicServerUrl}/dashboard`,
    `Admin: ${publicServerUrl}/admin`,
  ]
  consola.box(startupLinks.join("\n"))

  const { server } = await import("./server")

  const bindHost = process.env.HOST ?? "0.0.0.0"
  consola.info(`Server bind: http://${bindHost}:${options.port}`)
  consola.info(`Server public URL: ${publicServerUrl}`)

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
    hostname: bindHost,
    bun: {
      idleTimeout: 0,
    },
  })
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: process.env.PORT ?? String(DEFAULT_PORT),
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Copilot API config",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch and refresh",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    "database-url": {
      alias: "d",
      type: "string",
      description: "Database URL. Supports postgres://, mysql://, mongodb://",
    },
    "db-client": {
      type: "string",
      description:
        "Database backend to force (postgres|mysql|mongodb|memory). Optional if URL is explicit.",
    },
    "mysql-url": {
      type: "string",
      description: "MySQL connection URL (overrides MYSQL_URL env var)",
    },
    "mongodb-url": {
      type: "string",
      description: "MongoDB connection URL (overrides MONGODB_URL env var)",
    },
    "admin-password": {
      type: "string",
      description:
        "Admin dashboard password (overrides ADMIN_PASSWORD env var)",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

    return runServer({
      port: parsePortOrThrow(args.port),
      verbose: args.verbose,
      accountType: args["account-type"],
      manual: args.manual,
      rateLimit,
      rateLimitWait: args.wait,
      githubToken: args["github-token"],
      claudeCode: args["claude-code"],
      showToken: args["show-token"],
      proxyEnv: args["proxy-env"],
      dbClient: args["db-client"],
      databaseUrl: args["database-url"],
      mysqlUrl: args["mysql-url"],
      mongodbUrl: args["mongodb-url"],
      adminPassword: args["admin-password"],
    })
  },
})
