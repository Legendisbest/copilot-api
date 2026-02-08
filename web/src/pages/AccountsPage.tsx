import { useMemo, useState } from "react"

import type { Account } from "../api/client"
import {
  rebalanceAccountWeights,
  refreshAllAccounts,
  resetAllAccountCounters,
} from "../api/client"
import { AccountCard } from "../components/AccountCard"
import { AddAccountModal } from "../components/AddAccountModal"
import { useAccounts } from "../hooks/useAccounts"

type SortField = "status" | "type" | "requests" | "lastUsed"
type SortDirection = "asc" | "desc"
type StatusFilter = "all" | "active" | "rate_limited" | "dead" | "forbidden" | "disabled"
type PlanFilter = "all" | "free" | "premium"

export function AccountsPage() {
  const { accounts, refresh } = useAccounts()
  const [showAddModal, setShowAddModal] = useState(false)
  const [sortField, setSortField] = useState<SortField>("type")
  const [sortDir, setSortDir] = useState<SortDirection>("asc")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all")
  const [search, setSearch] = useState("")
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  const statusOrder: Record<string, number> = {
    active: 0,
    rate_limited: 1,
    dead: 2,
    forbidden: 3,
    disabled: 4,
  }

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    const filtered = accounts.filter((account) => {
      if (statusFilter !== "all" && account.status !== statusFilter) {
        return false
      }
      if (planFilter === "free" && account.isPremium) return false
      if (planFilter === "premium" && !account.isPremium) return false
      if (!normalizedQuery) return true

      const haystack = [
        account.label ?? "",
        account.githubUsername ?? "",
        account.accountType,
        account.status,
        account.errorCode ?? "",
      ]
        .join(" ")
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })

    return filtered.sort((a: Account, b: Account) => {
      let cmp = 0
      switch (sortField) {
        case "status":
          cmp = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
          break
        case "type":
          cmp = Number(a.isPremium) - Number(b.isPremium)
          break
        case "requests":
          cmp = a.totalRequests - b.totalRequests
          break
        case "lastUsed": {
          const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0
          const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0
          cmp = aTime - bTime
          break
        }
      }
      return sortDir === "desc" ? -cmp : cmp
    })
  }, [accounts, planFilter, search, sortDir, sortField, statusFilter])

  async function runBulkAction(task: () => Promise<string>) {
    setActionBusy(true)
    setActionMessage(null)
    try {
      const message = await task()
      setActionMessage(message)
      await refresh()
    } catch (error) {
      setActionMessage(`Error: ${(error as Error).message}`)
    } finally {
      setActionBusy(false)
    }
  }

  const freeCount = accounts.filter((account) => !account.isPremium).length
  const premiumCount = accounts.filter((account) => account.isPremium).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-bold text-white">Accounts ({accounts.length})</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors"
          >
            Refresh
          </button>
          <button
            disabled={actionBusy}
            onClick={() =>
              runBulkAction(async () => {
                const result = await refreshAllAccounts()
                return `Refreshed ${result.refreshed} accounts${result.failed > 0 ? ` (${result.failed} failed)` : ""}.`
              })
            }
            className="px-3 py-1.5 text-xs bg-blue-700/30 text-blue-200 hover:bg-blue-700/50 rounded transition-colors disabled:opacity-50"
          >
            Refresh All
          </button>
          <button
            disabled={actionBusy}
            onClick={() =>
              runBulkAction(async () => {
                const result = await resetAllAccountCounters()
                return `Reset counters for ${result.updated} accounts.`
              })
            }
            className="px-3 py-1.5 text-xs bg-cyan-700/30 text-cyan-200 hover:bg-cyan-700/50 rounded transition-colors disabled:opacity-50"
          >
            Reset Counters
          </button>
          <button
            disabled={actionBusy}
            onClick={() =>
              runBulkAction(async () => {
                await rebalanceAccountWeights()
                return "Rebalanced weights (premium=3, free=1)."
              })
            }
            className="px-3 py-1.5 text-xs bg-indigo-700/30 text-indigo-200 hover:bg-indigo-700/50 rounded transition-colors disabled:opacity-50"
          >
            Rebalance Weights
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors font-medium"
          >
            + Add Account
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
          Free: {freeCount}
        </span>
        <span className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-green-200">
          Premium: {premiumCount}
        </span>
        <span className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
          Showing: {filteredAndSorted.length}
        </span>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search label, username, status, error code"
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 md:col-span-2"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="rate_limited">Rate Limited</option>
          <option value="dead">Dead</option>
          <option value="forbidden">Forbidden</option>
          <option value="disabled">Disabled</option>
        </select>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Plans</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
        </select>
      </div>

      <div className="flex gap-1.5 mb-4">
        {(
          [
            ["status", "Status"],
            ["type", "Plan"],
            ["requests", "Requests"],
            ["lastUsed", "Last Used"],
          ] as [SortField, string][]
        ).map(([field, label]) => (
          <button
            key={field}
            onClick={() => toggleSort(field)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              sortField === field
                ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                : "bg-gray-800 text-gray-400 hover:text-white border border-transparent"
            }`}
          >
            {label} {sortField === field && (sortDir === "asc" ? "^" : "v")}
          </button>
        ))}
      </div>

      {actionMessage && (
        <div
          className={`mb-4 rounded px-3 py-2 text-xs ${
            actionMessage.startsWith("Error")
              ? "bg-red-500/10 border border-red-500/20 text-red-300"
              : "bg-green-500/10 border border-green-500/20 text-green-300"
          }`}
        >
          {actionMessage}
        </div>
      )}

      {filteredAndSorted.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No accounts matched your filters.</p>
          <button
            onClick={() => {
              setSearch("")
              setPlanFilter("all")
              setStatusFilter("all")
            }}
            className="px-4 py-2 bg-gray-700 text-white text-sm rounded hover:bg-gray-600 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSorted.map((account) => (
            <AccountCard key={account.id} account={account} onRefresh={refresh} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddAccountModal onClose={() => setShowAddModal(false)} onSuccess={refresh} />
      )}
    </div>
  )
}

