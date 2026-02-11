import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import {
  createAuthMiddleware,
  getConfiguredApiKeys,
  parseApiKeysFromEnv,
} from "../src/lib/request-auth"

describe("request auth", () => {
  test("parseApiKeysFromEnv handles commas, newlines, and de-duplication", () => {
    const keys = parseApiKeysFromEnv("alpha, beta\nalpha,,gamma")
    expect(keys).toEqual(["alpha", "beta", "gamma"])
  })

  test("getConfiguredApiKeys merges config and environment keys", () => {
    const prevAuthApiKeys = process.env.AUTH_API_KEYS
    const prevApiKeys = process.env.API_KEYS
    const prevApiKey = process.env.API_KEY

    process.env.AUTH_API_KEYS = "envA,envB"
    process.env.API_KEYS = "envB,envC"
    process.env.API_KEY = "envD"

    try {
      const keys = getConfiguredApiKeys()
      expect(keys).toContain("envA")
      expect(keys).toContain("envB")
      expect(keys).toContain("envC")
      expect(keys).toContain("envD")
    } finally {
      process.env.AUTH_API_KEYS = prevAuthApiKeys
      process.env.API_KEYS = prevApiKeys
      process.env.API_KEY = prevApiKey
    }
  })

  test("middleware allows dashboard and admin without API key by default", async () => {
    const app = new Hono()
    app.use("*", createAuthMiddleware({ getApiKeys: () => ["secret-key"] }))

    app.get("/dashboard", (c) => c.text("ok"))
    app.get("/dashboard/login", (c) => c.text("ok"))
    app.get("/assets/main.js", (c) => c.text("ok"))
    app.post("/admin/login", (c) => c.text("ok"))
    app.get("/v1/models", (c) => c.text("ok"))

    expect((await app.request("/dashboard")).status).toBe(200)
    expect((await app.request("/dashboard/login")).status).toBe(200)
    expect((await app.request("/assets/main.js")).status).toBe(200)
    expect((await app.request("/admin/login", { method: "POST" })).status).toBe(
      200,
    )
    expect((await app.request("/v1/models")).status).toBe(401)
  })

  test("middleware accepts x-api-key and bearer token", async () => {
    const app = new Hono()
    app.use("*", createAuthMiddleware({ getApiKeys: () => ["secret-key"] }))
    app.get("/v1/models", (c) => c.text("ok"))

    const xApiKeyResponse = await app.request("/v1/models", {
      headers: {
        "x-api-key": "secret-key",
      },
    })
    expect(xApiKeyResponse.status).toBe(200)

    const bearerResponse = await app.request("/v1/models", {
      headers: {
        Authorization: "Bearer secret-key",
      },
    })
    expect(bearerResponse.status).toBe(200)
  })
})
