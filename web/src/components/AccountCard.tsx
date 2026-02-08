import { useMemo, useState } from "react"

import type { Account, AccountUsage } from "../api/client"
import {
  fetchAccountUsage,
  refreshAccountToken,
  removeAccount,
  updateAccount,
} from "../api/client"
import { StatusBadge } from "./StatusBadge"
import { UsageBar } from "./UsageBar"

const FREE_QUOTA_EXHAUSTED_CODE = "FREE_QUOTA_EXHAUSTED"

const toInputValue = (value: number | null): string => {
  return value === null ? "" : String(value)
}

const parseOptionalPositiveInt = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return null
  return parsed
}

export function AccountCard({
  account,
  onRefresh,
}: {
  account: Account
  onRefresh: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [usage, setUsage] = useState<AccountUsage | null>(null)
  const [showUsage, setShowUsage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(account.label ?? "")
  const [hourlyDraft, setHourlyDraft] = useState(toInputValue(account.maxRequestsPerHour))
  const [dailyDraft, setDailyDraft] = useState(toInputValue(account.maxRequestsPerDay))
  const [weightDraft, setWeightDraft] = useState(String(account.rotationWeight))

  const limitSummary = useMemo(() => {
    const hourly = account.maxRequestsPerHour
    const daily = account.maxRequestsPerDay
    if (!hourly && !daily) return "No custom limits"
    const parts = new Array<string>()
    if (hourly) parts.push(`${hourly}/hour`)
    if (daily) parts.push(`${daily}/day`)
    return parts.join(" | ")
  }, [account.maxRequestsPerDay, account.maxRequestsPerHour])

  async function handleAction(action: () => Promise<void>) {
    setLoading(true)
    setError(null)
    try {
      await action()
      onRefresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleUsage() {
    if (showUsage) {
      setShowUsage(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAccountUsage(account.id)
      setUsage(data)
      setShowUsage(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveEdits() {
    const parsedHourly = parseOptionalPositiveInt(hourlyDraft)
    const parsedDaily = parseOptionalPositiveInt(dailyDraft)
    const parsedWeight = Number.parseInt(weightDraft, 10)

    if (weightDraft.trim().length === 0 || Number.isNaN(parsedWeight) || parsedWeight <= 0) {
      setError("Rotation weight must be a positive number.")
      return
    }

    await handleAction(async () => {
      await updateAccount(account.id, {
        label: labelDraft.trim() ? labelDraft.trim() : null,
        maxRequestsPerHour: parsedHourly,
        maxRequestsPerDay: parsedDaily,
        rotationWeight: parsedWeight,
      })
      setEditing(false)
    })
  }

  function handleCancelEdits() {
    setEditing(false)
    setLabelDraft(account.label ?? "")
    setHourlyDraft(toInputValue(account.maxRequestsPerHour))
    setDailyDraft(toInputValue(account.maxRequestsPerDay))
    setWeightDraft(String(account.rotationWeight))
    setError(null)
  }

  const freeExhausted = Boolean(
    !account.isPremium
      && account.premiumUnlimited === false
      && (account.premiumRemaining ?? 0) <= 0,
  )

  const timeAgo = account.lastUsedAt ?
      formatTimeAgo(new Date(account.lastUsedAt))
    : "Never"

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white">
              {account.label ?? account.githubUsername ?? "Unknown"}
            </h3>
            {account.isPremium ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                PREMIUM
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                FREE
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            @{account.githubUsername ?? "unknown"} | {account.accountType}
          </p>
        </div>
        <StatusBadge status={account.status} />
      </div>

      {account.statusMessage && (
        <div className="mb-3 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-300">
          {account.statusMessage}
        </div>
      )}

      {(account.errorCode || freeExhausted) && (
        <div className="mb-3 px-2 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded text-xs text-orange-300">
          Error code:{" "}
          <code className="font-mono">
            {account.errorCode
              ?? (freeExhausted ? FREE_QUOTA_EXHAUSTED_CODE : "UNKNOWN")}
          </code>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-xs text-gray-500">Requests</p>
          <p className="text-sm font-semibold text-white">
            {account.totalRequests.toLocaleString()}
          </p>
        </div>
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-xs text-gray-500">Models</p>
          <p className="text-sm font-semibold text-white">{account.modelCount}</p>
        </div>
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-xs text-gray-500">Last Used</p>
          <p className="text-sm font-semibold text-white">{timeAgo}</p>
        </div>
      </div>

      <div className="mb-3 rounded bg-gray-800/40 border border-gray-700 px-2 py-1.5">
        <p className="text-[11px] text-gray-400">
          Limits: <span className="text-gray-200">{limitSummary}</span>
        </p>
        <p className="text-[11px] text-gray-400">
          Weight: <span className="text-gray-200">{account.rotationWeight}</span>
        </p>
      </div>

      {editing && (
        <div className="mb-3 rounded border border-indigo-500/30 bg-indigo-500/10 p-3 space-y-2">
          <label className="text-xs text-indigo-100 flex flex-col gap-1">
            Label
            <input
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm text-white"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-indigo-100 flex flex-col gap-1">
              Hourly limit
              <input
                value={hourlyDraft}
                onChange={(event) => setHourlyDraft(event.target.value)}
                placeholder="none"
                className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm text-white"
              />
            </label>
            <label className="text-xs text-indigo-100 flex flex-col gap-1">
              Daily limit
              <input
                value={dailyDraft}
                onChange={(event) => setDailyDraft(event.target.value)}
                placeholder="none"
                className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm text-white"
              />
            </label>
            <label className="text-xs text-indigo-100 flex flex-col gap-1">
              Rotation weight
              <input
                value={weightDraft}
                onChange={(event) => setWeightDraft(event.target.value)}
                className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm text-white"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveEdits}
              disabled={loading}
              className="px-2.5 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={handleCancelEdits}
              disabled={loading}
              className="px-2.5 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showUsage && usage?.quota_snapshots && (
        <div className="mb-3 p-2 bg-gray-800/30 rounded">
          {usage.quota_snapshots.premium_interactions && (
            <UsageBar
              label="Premium"
              used={
                usage.quota_snapshots.premium_interactions.entitlement
                - usage.quota_snapshots.premium_interactions.remaining
              }
              total={usage.quota_snapshots.premium_interactions.entitlement}
              unlimited={usage.quota_snapshots.premium_interactions.unlimited}
            />
          )}
          {usage.quota_snapshots.chat && (
            <UsageBar
              label="Chat"
              used={
                usage.quota_snapshots.chat.entitlement
                - usage.quota_snapshots.chat.remaining
              }
              total={usage.quota_snapshots.chat.entitlement}
              unlimited={usage.quota_snapshots.chat.unlimited}
            />
          )}
          {usage.quota_snapshots.completions && (
            <UsageBar
              label="Completions"
              used={
                usage.quota_snapshots.completions.entitlement
                - usage.quota_snapshots.completions.remaining
              }
              total={usage.quota_snapshots.completions.entitlement}
              unlimited={usage.quota_snapshots.completions.unlimited}
            />
          )}
          {usage.quota_reset_date && (
            <p className="text-[10px] text-gray-500 mt-1">
              Resets: {new Date(usage.quota_reset_date).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {error && <div className="mb-3 text-xs text-red-400">{error}</div>}

      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={handleToggleUsage}
          disabled={loading || account.status !== "active"}
          className="px-2.5 py-1 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {showUsage ? "Hide Usage" : "Usage"}
        </button>
        <button
          onClick={() => handleAction(() => refreshAccountToken(account.id))}
          disabled={loading}
          className="px-2.5 py-1 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50 transition-colors"
        >
          Refresh
        </button>
        <button
          onClick={() => setEditing((value) => !value)}
          disabled={loading}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 disabled:opacity-50 transition-colors"
        >
          {editing ? "Close Edit" : "Edit"}
        </button>
        <button
          onClick={() =>
            handleAction(() =>
              updateAccount(account.id, { action: "reset_counters" }).then(() => {}),
            )
          }
          disabled={loading}
          className="px-2.5 py-1 text-xs rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 disabled:opacity-50 transition-colors"
        >
          Reset
        </button>
        {account.status === "disabled" ? (
          <button
            onClick={() =>
              handleAction(() =>
                updateAccount(account.id, { action: "enable" }).then(() => {}),
              )
            }
            disabled={loading}
            className="px-2.5 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:opacity-50 transition-colors"
          >
            Enable
          </button>
        ) : (
          <button
            onClick={() =>
              handleAction(() =>
                updateAccount(account.id, { action: "disable" }).then(() => {}),
              )
            }
            disabled={loading}
            className="px-2.5 py-1 text-xs rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 disabled:opacity-50 transition-colors"
          >
            Disable
          </button>
        )}
        <button
          onClick={() =>
            handleAction(async () => {
              if (confirm(`Remove account "${account.label ?? account.githubUsername}"?`)) {
                await removeAccount(account.id)
              }
            })
          }
          disabled={loading}
          className="px-2.5 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

