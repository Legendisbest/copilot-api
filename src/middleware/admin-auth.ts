import type { Context } from "hono"

import { createMiddleware } from "hono/factory"
import { sign, verify } from "hono/jwt"
import { randomBytes, timingSafeEqual } from "node:crypto"

const DEV_FALLBACK_JWT_SECRET = "copilot-api-default-secret"
const DEV_FALLBACK_ADMIN_PASSWORD = "admin"
const runtimeJwtSecret = randomBytes(32).toString("hex")

const isProductionRuntime = () => process.env.NODE_ENV === "production"

const getJwtSecret = () =>
  process.env.JWT_SECRET
  ?? (isProductionRuntime() ? runtimeJwtSecret : DEV_FALLBACK_JWT_SECRET)

const getAdminPassword = () =>
  process.env.ADMIN_PASSWORD
  ?? (isProductionRuntime() ? null : DEV_FALLBACK_ADMIN_PASSWORD)

const secretsMatch = (input: string, expected: string): boolean => {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)
  if (inputBuffer.length !== expectedBuffer.length) {
    return false
  }
  return timingSafeEqual(inputBuffer, expectedBuffer)
}

/** Login handler - validates password and returns a JWT */
export async function adminLogin(c: Context) {
  const body = await c.req.json<{ password?: string }>()
  const adminPassword = getAdminPassword()

  if (!adminPassword) {
    return c.json(
      {
        error:
          "Admin login is disabled until ADMIN_PASSWORD is configured for this runtime.",
      },
      503,
    )
  }

  if (!body.password || !secretsMatch(body.password, adminPassword)) {
    return c.json({ error: "Invalid password" }, 401)
  }

  const token = await sign(
    {
      role: "admin",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    },
    getJwtSecret(),
  )

  return c.json({ token })
}

/** JWT authentication middleware for admin routes */
export const adminAuth = createMiddleware(async (c, next) => {
  if (c.req.path === "/admin/login" || c.req.method === "OPTIONS") {
    return next()
  }

  const authHeader = c.req.header("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      { error: "Unauthorized - missing or invalid Authorization header" },
      401,
    )
  }

  try {
    const token = authHeader.slice(7)
    await verify(token, getJwtSecret())
    await next()
  } catch {
    return c.json({ error: "Unauthorized - invalid or expired token" }, 401)
  }
})
