export function UsageBar({
  label,
  used,
  total,
  unlimited,
}: {
  label: string
  used: number
  total: number
  unlimited: boolean
}) {
  if (unlimited) {
    return (
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-400">{label}</span>
          <span className="text-green-400">Unlimited</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-1.5">
          <div className="bg-green-500 h-1.5 rounded-full w-full opacity-30" />
        </div>
      </div>
    )
  }

  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const barColor =
    percentage > 90
      ? "bg-red-500"
      : percentage > 70
        ? "bg-yellow-500"
        : "bg-blue-500"

  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300">
          {used} / {total} ({Math.round(percentage)}%)
        </span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div
          className={`${barColor} h-1.5 rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
