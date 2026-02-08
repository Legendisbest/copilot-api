const statusColors: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  rate_limited: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  dead: "bg-red-500/20 text-red-400 border-red-500/30",
  forbidden: "bg-red-500/20 text-red-400 border-red-500/30",
  disabled: "bg-gray-500/20 text-gray-400 border-gray-500/30",
}

const statusLabels: Record<string, string> = {
  active: "Active",
  rate_limited: "Rate Limited",
  dead: "Dead",
  forbidden: "Forbidden",
  disabled: "Disabled",
}

export function StatusBadge({ status }: { status: string }) {
  const colors = statusColors[status] ?? statusColors.disabled
  const label = statusLabels[status] ?? status

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
          status === "active"
            ? "bg-green-400"
            : status === "rate_limited"
              ? "bg-yellow-400"
              : status === "dead" || status === "forbidden"
                ? "bg-red-400"
                : "bg-gray-400"
        }`}
      />
      {label}
    </span>
  )
}
