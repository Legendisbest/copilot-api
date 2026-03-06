import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { readFileSync } from "node:fs"

import { createAuthMiddleware } from "./lib/request-auth"
import { getCorsOptions } from "./lib/server-security"
// Multi-account & dashboard imports
import { accountRotation } from "./middleware/account-rotation"
import { adminRoutes } from "./routes/admin/route"
import { completionRoutes } from "./routes/chat-completions/route"
import { dashboardRoute } from "./routes/dashboard/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { responsesRoutes } from "./routes/responses/route"
import { tokenRoute } from "./routes/token/route"
import { usageRoute } from "./routes/usage/route"

export const server = new Hono()

server.use(logger())
server.use(cors(getCorsOptions()))
server.use(
  "*",
  createAuthMiddleware({
    allowUnauthenticatedPaths: ["/", "/usage-viewer", "/usage-viewer/"],
  }),
)

// Account rotation middleware (no-op in legacy single-account mode)
server.use("/chat/completions/*", accountRotation)
server.use("/models/*", accountRotation)
server.use("/embeddings/*", accountRotation)
server.use("/usage/*", accountRotation)
server.use("/token/*", accountRotation)
server.use("/responses/*", accountRotation)
server.use("/v1/*", accountRotation)

server.get("/", (c) => c.text("Server running"))
server.get("/health", (c) => c.json({ ok: true }))
server.get("/usage-viewer", (c) => {
  const usageViewerFileUrl = new URL("../pages/index.html", import.meta.url)
  return c.html(readFileSync(usageViewerFileUrl, "utf8"))
})
server.get("/usage-viewer/", (c) => c.redirect("/usage-viewer", 301))

server.route("/chat/completions", completionRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token", tokenRoute)
server.route("/responses", responsesRoutes)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)
server.route("/v1/responses", responsesRoutes)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)

// Admin API (JWT-protected) and dashboard (static SPA)
server.route("/admin", adminRoutes)
server.route("/dashboard", dashboardRoute)
server.route("/assets", dashboardRoute)
