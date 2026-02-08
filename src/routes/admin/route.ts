import { Hono } from "hono"

import { adminAuth, adminLogin } from "~/middleware/admin-auth"
import {
  addAccount,
  getAccountUsage,
  getStats,
  listAccounts,
  pollDeviceFlow,
  refreshAccountToken,
  removeAccount,
  startDeviceFlow,
  updateAccount,
} from "./handlers/accounts"
import { getSettings, updateSettings } from "./handlers/settings"

export const adminRoutes = new Hono()

// Login endpoint (no auth required)
adminRoutes.post("/login", adminLogin)

// All other admin routes require authentication
adminRoutes.use("/*", adminAuth)

// Account management
adminRoutes.get("/accounts", listAccounts)
adminRoutes.post("/accounts", addAccount)
adminRoutes.delete("/accounts/:id", removeAccount)
adminRoutes.patch("/accounts/:id", updateAccount)
adminRoutes.post("/accounts/:id/refresh", refreshAccountToken)
adminRoutes.get("/accounts/:id/usage", getAccountUsage)

// Device flow for adding accounts via dashboard
adminRoutes.post("/accounts/device-flow/start", startDeviceFlow)
adminRoutes.post("/accounts/device-flow/poll", pollDeviceFlow)

// Stats
adminRoutes.get("/stats", getStats)

// Settings
adminRoutes.get("/settings", getSettings)
adminRoutes.put("/settings", updateSettings)
