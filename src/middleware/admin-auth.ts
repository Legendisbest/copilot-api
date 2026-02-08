import { createMiddleware } from "hono/factory"
import { sign, verify } from "hono/jwt"
import type { Context } from "hono"

const getJwtSecret = () => process.env.JWT_SECRET ?? "copilot-api-default-secret"
const getAdminPassword = () => process.env.ADMIN_PASSWORD ?? "admin"

/** Login handler — validates password and returns a JWT */
export async function adminLogin(c: Context) {
  const body = await c.req.json<{ password?: string }>()

  if (!body.password || body.password !== getAdminPassword()) {
    return c.json({ error: "Invalid password" }, 401)
  }

  const token = await sign(
    {
      role: "admin",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
    },
    getJwtSecret(),
  )

  return c.json({ token })
}

/** JWT authentication middleware for admin routes */
export const adminAuth = createMiddleware(async (c, next) => {
  // Skip auth for login endpoint
  if (c.req.path === "/admin/login" || c.req.method === "OPTIONS") {
    return next()
  }

  const authHeader = c.req.header("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — missing or invalid Authorization header" }, 401)
  }

  try {
    const token = authHeader.slice(7)
    await verify(token, getJwtSecret())
    await next()
  } catch {
    return c.json({ error: "Unauthorized — invalid or expired token" }, 401)
  }
})
