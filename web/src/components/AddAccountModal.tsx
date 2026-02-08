import { useState } from "react"
import {
  startDeviceFlow,
  pollDeviceFlow,
  addAccountByToken,
} from "../api/client"

export function AddAccountModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [mode, setMode] = useState<"token" | "device">("device")
  const [token, setToken] = useState("")
  const [label, setLabel] = useState("")
  const [accountType, setAccountType] = useState("individual")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Device flow state
  const [userCode, setUserCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [, setFlowId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)

  async function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await addAccountByToken(token, label || undefined, accountType)
      onSuccess()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleStartDeviceFlow() {
    setLoading(true)
    setError(null)
    try {
      const result = await startDeviceFlow(label || undefined, accountType)
      setUserCode(result.userCode)
      setVerificationUri(result.verificationUri)
      setFlowId(result.flowId)

      // Start polling
      setPolling(true)
      pollForCompletion(result.flowId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function pollForCompletion(id: string) {
    const maxAttempts = 60
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      try {
        const result = await pollDeviceFlow(id)
        if (result.success) {
          setPolling(false)
          onSuccess()
          onClose()
          return
        }
        if (result.error) {
          setError(result.error)
          setPolling(false)
          return
        }
      } catch (err) {
        setError((err as Error).message)
        setPolling(false)
        return
      }
    }
    setError("Device flow timed out")
    setPolling(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Add Account</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            X
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setMode("device")}
            className={`flex-1 py-1.5 text-sm rounded ${
              mode === "device"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            GitHub Login
          </button>
          <button
            onClick={() => setMode("token")}
            className={`flex-1 py-1.5 text-sm rounded ${
              mode === "token"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            Paste Token
          </button>
        </div>

        {/* Common fields */}
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. work-account"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Account Type
            </label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="individual">Individual</option>
              <option value="business">Business</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>

        {/* Token mode */}
        {mode === "token" && (
          <form onSubmit={handleTokenSubmit} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                GitHub Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="gho_..."
                required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Generate using: copilot-api auth
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded disabled:opacity-50 transition-colors"
            >
              {loading ? "Adding..." : "Add Account"}
            </button>
          </form>
        )}

        {/* Device flow mode */}
        {mode === "device" && !userCode && (
          <button
            onClick={handleStartDeviceFlow}
            disabled={loading}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded disabled:opacity-50 transition-colors"
          >
            {loading ? "Starting..." : "Start GitHub Login"}
          </button>
        )}

        {mode === "device" && userCode && (
          <div className="text-center space-y-3">
            <p className="text-sm text-gray-300">
              Enter this code on GitHub:
            </p>
            <div className="bg-gray-800 border border-gray-600 rounded-lg py-3 px-4">
              <span className="text-2xl font-mono font-bold text-white tracking-widest">
                {userCode}
              </span>
            </div>
            <a
              href={verificationUri ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-gray-800 text-blue-400 hover:text-blue-300 text-sm rounded border border-gray-700 hover:border-gray-600 transition-colors"
            >
              Open {verificationUri}
            </a>
            {polling && (
              <p className="text-xs text-gray-400 animate-pulse">
                Waiting for authorization...
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
