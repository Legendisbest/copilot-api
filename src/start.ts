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

async function tryReadLegacyGithubToken(): Promise<string | null> {
  try {
    const token = await fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")
    return token.trim() || null
  } catch {
    return null
  }
}

export async function runServer(options: RunServerOptions): Promise<void> {
  // Ensure config is merged with defaults at startup
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

  // Set admin password and JWT secret from options/env
  if (options.adminPassword) {
    process.env.ADMIN_PASSWORD = options.adminPassword
  }

  await ensurePaths()
  await cacheVSCodeVersion()

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  const mysqlUrl = options.mysqlUrl ?? process.env.MYSQL_URL
  const mongodbUrl = options.mongodbUrl ?? process.env.MONGODB_URL

  await initDataStore({
    client: options.dbClient,
    databaseUrl,
    mysqlUrl,
    mongodbUrl,
  })

  const persistentStore = isPersistentDataStore()

  if (persistentStore) {
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
      consola.info("No accounts found. Starting device flow to add first account...")
      const { getDeviceCode } = await import("./services/github/get-device-code")
      const { pollAccessToken } = await import(
        "./services/github/poll-access-token"
      )

      const deviceCode = await getDeviceCode()
      consola.info(
        `Please enter the code "${deviceCode.user_code}" in ${deviceCode.verification_uri}`,
      )
      const token = await pollAccessToken(deviceCode)
      await accountManager.addAccount(token, "initial-account", options.accountType)
    }

    const allAccounts = accountManager.getAllAccounts()
    const activeAccounts = allAccounts.filter((a) => a.status === "active")
    consola.info(
      `Accounts: ${activeAccounts.length} active / ${allAccounts.length} total`,
    )

    const firstActive = activeAccounts[0]
    if (firstActive?.models) {
      consola.info(
        `Available models: \n${firstActive.models.data.map((model) => `- ${model.id}`).join("\n")}`,
      )
      if (!state.models) {
        state.models = firstActive.models
      }
    }
  } else {
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

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
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

  const dashboardUrl = persistentStore
    ? `\nDashboard: ${serverUrl}/dashboard`
    : ""
  consola.box(
    `Usage Viewer: https://ericc-ch.github.io/copilot-api?endpoint=${serverUrl}/usage${dashboardUrl}`,
  )

  const { server } = await import("./server")

  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
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
      default: "4141",
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
      description:
        "Database URL. Supports postgres://, mysql://, mongodb://",
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
      port: Number.parseInt(args.port, 10),
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
