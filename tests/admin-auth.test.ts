import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { adminLogin } from "../src/middleware/admin-auth"

const restoreNodeEnv = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env.NODE_ENV
    return
  }

  process.env.NODE_ENV = value
}

const restoreAdminPassword = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env.ADMIN_PASSWORD
    return
  }

  process.env.ADMIN_PASSWORD = value
}

describe("admin auth", () => {
  test("production login is disabled until ADMIN_PASSWORD is configured", async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousAdminPassword = process.env.ADMIN_PASSWORD

    process.env.NODE_ENV = "production"
    delete process.env.ADMIN_PASSWORD

    try {
      const app = new Hono()
      app.post("/admin/login", adminLogin)

      const response = await app.request("/admin/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "admin" }),
      })

      expect(response.status).toBe(503)
    } finally {
      restoreNodeEnv(previousNodeEnv)
      restoreAdminPassword(previousAdminPassword)
    }
  })
})
