import { Hono } from "hono"
import fs from "node:fs"
import path from "node:path"

export const dashboardRoute = new Hono()

// Resolve the web dist directory relative to this file's location
function getWebDistPath(): string {
  // Try import.meta.dirname first (Bun/Node 22+)
  if (import.meta.dirname) {
    return path.resolve(import.meta.dirname, "../../dist/web")
  }
  // Fallback: resolve from CWD
  return path.resolve(process.cwd(), "dist/web")
}

const webDistPath = getWebDistPath()

// Serve static files for the dashboard SPA
dashboardRoute.get("/*", async (c) => {
  const reqPath = c.req.path.replace("/dashboard", "") || "/"
  const filePath = path.join(webDistPath, reqPath === "/" ? "index.html" : reqPath)

  try {
    // Check if the exact file exists
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      }
      const contentType = mimeTypes[ext] ?? "application/octet-stream"
      return new Response(content, {
        headers: { "Content-Type": contentType },
      })
    }

    // SPA fallback: serve index.html for any unmatched route
    const indexPath = path.join(webDistPath, "index.html")
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, "utf-8")
      return c.html(content)
    }

    return c.text("Dashboard not built. Run: npm run build:web", 404)
  } catch {
    return c.text("Dashboard not available", 500)
  }
})
