import { useState } from "react"
import { useAccounts } from "../hooks/useAccounts"
import { AccountCard } from "../components/AccountCard"
import { AddAccountModal } from "../components/AddAccountModal"
import type { Account } from "../api/client"

type SortField = "status" | "type" | "requests" | "lastUsed"
type SortDirection = "asc" | "desc"

export function AccountsPage() {
  const { accounts, refresh } = useAccounts()
  const [showAddModal, setShowAddModal] = useState(false)
  const [sortField, setSortField] = useState<SortField>("type")
  const [sortDir, setSortDir] = useState<SortDirection>("asc")

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

  const sorted = [...accounts].sort((a: Account, b: Account) => {
    let cmp = 0
    switch (sortField) {
      case "status":
        cmp =
          (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9)
        break
      case "type":
        cmp = Number(a.isPremium) - Number(b.isPremium)
        break
      case "requests":
        cmp = a.totalRequests - b.totalRequests
        break
      case "lastUsed": {
        const aTime = a.lastUsedAt
          ? new Date(a.lastUsedAt).getTime()
          : 0
        const bTime = b.lastUsedAt
          ? new Date(b.lastUsedAt).getTime()
          : 0
        cmp = aTime - bTime
        break
      }
    }
    return sortDir === "desc" ? -cmp : cmp
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">
          Accounts ({accounts.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors font-medium"
          >
            + Add Account
          </button>
        </div>
      </div>

      {/* Sort controls */}
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
            {label}{" "}
            {sortField === field && (sortDir === "asc" ? "^" : "v")}
          </button>
        ))}
      </div>

      {/* Accounts grid */}
      {sorted.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No accounts added yet.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
          >
            Add Your First Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}

      {/* Add account modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSuccess={refresh}
        />
      )}
    </div>
  )
}
