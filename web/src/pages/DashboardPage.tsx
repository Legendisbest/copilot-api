import { useState, useEffect } from "react"
import { fetchStats, type Stats } from "../api/client"
import { useAccounts } from "../hooks/useAccounts"
import { AccountCard } from "../components/AccountCard"

export function DashboardPage() {
  const { accounts, refresh } = useAccounts()
  const [stats, setStats] = useState<Stats | null>(null)

  const sortedAccounts = [...accounts].sort((a, b) => {
    const premiumDelta = Number(a.isPremium) - Number(b.isPremium)
    if (premiumDelta !== 0) return premiumDelta
    return a.totalRequests - b.totalRequests
  })

  useEffect(() => {
    fetchStats().then(setStats).catch(() => {})
    const interval = setInterval(() => {
      fetchStats().then(setStats).catch(() => {})
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div>
      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-3 mb-6">
        <StatCard
          label="Total Accounts"
          value={stats?.totalAccounts ?? 0}
        />
        <StatCard
          label="Active"
          value={stats?.activeAccounts ?? 0}
          color="text-green-400"
        />
        <StatCard
          label="Rate Limited"
          value={stats?.rateLimitedAccounts ?? 0}
          color="text-yellow-400"
        />
        <StatCard
          label="Dead/Forbidden"
          value={stats?.deadAccounts ?? 0}
          color="text-red-400"
        />
        <StatCard
          label="Disabled"
          value={stats?.disabledAccounts ?? 0}
          color="text-gray-300"
        />
        <StatCard
          label="Total Requests"
          value={stats?.totalRequests ?? 0}
          color="text-blue-400"
        />
        <StatCard
          label="Free"
          value={stats?.freeAccounts ?? 0}
          color="text-amber-300"
        />
        <StatCard
          label="Premium"
          value={stats?.premiumAccounts ?? 0}
          color="text-emerald-300"
        />
        <StatCard
          label="Free Exhausted"
          value={stats?.freeExhaustedAccounts ?? 0}
          color={(stats?.freeExhaustedAccounts ?? 0) > 0 ? "text-orange-300" : "text-gray-300"}
        />
      </div>

      {(stats?.freeExhaustedAccounts ?? 0) > 0 && (
        <div className="mb-4 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">
          Some free-tier accounts are exhausted. Check account cards for error codes and switch policy in Settings if needed.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
          Store: {stats?.dataStore ?? "unknown"}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
          Rotation: {stats?.rotationStrategy ?? "round_robin"}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
          Free Policy: {stats?.freeAccountPolicy ?? "prefer_free"}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
          Limits: {stats?.limitEnforcementEnabled ? "on" : "off"}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
          Auto Disable Free: {stats?.autoDisableFreeExhausted ? "on" : "off"}
        </span>
      </div>

      {/* Accounts grid */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">Accounts</h2>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors"
        >
          Refresh
        </button>
      </div>

      {sortedAccounts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No accounts configured</p>
          <p className="text-sm">
            Go to the Accounts tab to add your first GitHub account.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  color = "text-white",
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value.toLocaleString()}
      </p>
    </div>
  )
}
