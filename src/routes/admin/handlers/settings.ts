import type { Context } from "hono"

import { accountManager } from "~/lib/account-manager"
import { getDataStore, getDataStoreKind, isPersistentDataStore } from "~/lib/data-store"
import { trafficControlManager } from "~/lib/traffic-control"

/** Get all settings */
export async function getSettings(c: Context) {
  const values = await getDataStore().getSettings()
  return c.json({
    ...values,
    _meta: {
      dataStore: getDataStoreKind(),
      persistent: isPersistentDataStore(),
      runtime: accountManager.getRuntimeSettings(),
      traffic: trafficControlManager.getSettings(),
      trafficStats: trafficControlManager.getStats(),
    },
  })
}

/** Update settings */
export async function updateSettings(c: Context) {
  const body = await c.req.json<Record<string, unknown>>()
  if (!body || Object.keys(body).length === 0) {
    return c.json({ error: "No settings provided" }, 400)
  }

  // Runtime env overrides for auth settings
  if (typeof body.admin_password === "string" && body.admin_password.length > 0) {
    process.env.ADMIN_PASSWORD = body.admin_password
  }
  if (typeof body.jwt_secret === "string" && body.jwt_secret.length > 0) {
    process.env.JWT_SECRET = body.jwt_secret
  }

  const settingsToPersist = { ...body }
  delete settingsToPersist.admin_password
  delete settingsToPersist.jwt_secret

  if (Object.keys(settingsToPersist).length > 0) {
    await getDataStore().upsertSettings(settingsToPersist)
  }
  await accountManager.reloadSettings()
  await trafficControlManager.reloadSettings()

  return c.json({
    success: true,
    dataStore: getDataStoreKind(),
    runtime: accountManager.getRuntimeSettings(),
    traffic: trafficControlManager.getSettings(),
  })
}

