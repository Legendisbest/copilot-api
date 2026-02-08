import { useEffect, useMemo, useState } from "react"

import { fetchSettings, updateSettings } from "../api/client"

type RotationStrategy = "round_robin" | "least_used" | "weighted" | "free_first"
type FreePolicy = "balanced" | "prefer_free" | "prefer_premium"

interface SettingsResponse {
  rotation_strategy?: RotationStrategy
  free_account_policy?: FreePolicy
  free_account_exhausted_error?: boolean
  free_account_exhausted_error_code?: string
  _meta?: {
    dataStore?: string
    persistent?: boolean
    runtime?: {
      rotationStrategy?: RotationStrategy
      freeAccountPolicy?: FreePolicy
      freeAccountExhaustedError?: boolean
      freeAccountExhaustedErrorCode?: string
    }
  }
  [key: string]: unknown
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [rotationStrategy, setRotationStrategy] =
    useState<RotationStrategy>("round_robin")
  const [freePolicy, setFreePolicy] = useState<FreePolicy>("prefer_free")
  const [freeErrorEnabled, setFreeErrorEnabled] = useState(false)
  const [freeErrorCode, setFreeErrorCode] = useState("FREE_QUOTA_EXHAUSTED")

  useEffect(() => {
    fetchSettings()
      .then((raw) => {
        const typed = raw as SettingsResponse
        setSettings(typed)

        const runtime = typed._meta?.runtime
        setRotationStrategy(
          runtime?.rotationStrategy
            ?? typed.rotation_strategy
            ?? "round_robin",
        )
        setFreePolicy(
          runtime?.freeAccountPolicy
            ?? typed.free_account_policy
            ?? "prefer_free",
        )
        setFreeErrorEnabled(
          runtime?.freeAccountExhaustedError
            ?? typed.free_account_exhausted_error
            ?? false,
        )
        setFreeErrorCode(
          runtime?.freeAccountExhaustedErrorCode
            ?? typed.free_account_exhausted_error_code
            ?? "FREE_QUOTA_EXHAUSTED",
        )
      })
      .catch((error) => {
        setMessage(`Error loading settings: ${(error as Error).message}`)
      })
      .finally(() => setLoading(false))
  }, [])

  const dataStoreLabel = useMemo(() => {
    const dataStore = settings._meta?.dataStore
    const persistent = settings._meta?.persistent
    if (!dataStore) return "unknown"
    return `${dataStore}${persistent ? " (persistent)" : " (memory)"}`
  }, [settings._meta?.dataStore, settings._meta?.persistent])

  async function saveRuntimeSettings() {
    setSaving(true)
    setMessage(null)
    try {
      await updateSettings({
        rotation_strategy: rotationStrategy,
        free_account_policy: freePolicy,
        free_account_exhausted_error: freeErrorEnabled,
        free_account_exhausted_error_code: freeErrorCode.trim() || "FREE_QUOTA_EXHAUSTED",
      })
      setMessage("Rotation and free-tier settings saved.")
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!newPassword) return

    setSaving(true)
    setMessage(null)
    try {
      await updateSettings({ admin_password: newPassword })
      setMessage(
        "Password updated for this runtime. Set ADMIN_PASSWORD env var to persist across restarts.",
      )
      setNewPassword("")
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-gray-400 text-center py-12">Loading settings...</div>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-lg font-bold text-white">Settings</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Data Backend</h3>
        <p className="text-sm text-gray-300 mb-1">
          Active backend: <span className="font-mono text-blue-300">{dataStoreLabel}</span>
        </p>
        <p className="text-xs text-gray-500">
          Use one of these at startup: <code>--database-url</code>, <code>--mysql-url</code>, or <code>--mongodb-url</code>. Optional: <code>--db-client</code>.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Rotation Strategy</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Strategy
            <select
              value={rotationStrategy}
              onChange={(e) => setRotationStrategy(e.target.value as RotationStrategy)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="round_robin">Round Robin</option>
              <option value="least_used">Least Used</option>
              <option value="weighted">Weighted</option>
              <option value="free_first">Free First</option>
            </select>
          </label>

          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Free-tier policy
            <select
              value={freePolicy}
              onChange={(e) => setFreePolicy(e.target.value as FreePolicy)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="prefer_free">Prefer Free</option>
              <option value="balanced">Balanced</option>
              <option value="prefer_premium">Prefer Premium</option>
            </select>
          </label>
        </div>

        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={freeErrorEnabled}
              onChange={(e) => setFreeErrorEnabled(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-blue-500"
            />
            Throw explicit error when free accounts are exhausted
          </label>
          <label className="text-xs text-gray-300 flex flex-col gap-1">
            Free exhausted error code
            <input
              value={freeErrorCode}
              onChange={(e) => setFreeErrorCode(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <button
          onClick={saveRuntimeSettings}
          disabled={saving}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Rotation Settings"}
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Change Admin Password</h3>
        <form onSubmit={handleChangePassword} className="flex gap-2">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={saving || !newPassword}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Update"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Environment Variables</h3>
        <div className="space-y-2 text-xs text-gray-400">
          <p>
            <code className="text-blue-300">DATABASE_URL</code>: Generic DB URL (postgres/mysql/mongo)
          </p>
          <p>
            <code className="text-blue-300">MYSQL_URL</code>: MySQL fallback URL
          </p>
          <p>
            <code className="text-blue-300">MONGODB_URL</code>: MongoDB fallback URL
          </p>
          <p>
            <code className="text-blue-300">DB_CLIENT</code>: Force backend selection
          </p>
          <p>
            <code className="text-blue-300">ADMIN_PASSWORD</code>, <code className="text-blue-300">JWT_SECRET</code>: Dashboard auth
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`rounded border px-3 py-2 text-sm ${
            message.startsWith("Error")
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-green-500/30 bg-green-500/10 text-green-300"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}

