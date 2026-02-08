import { useCallback } from "react"

export function useAuth() {
  const token = localStorage.getItem("admin_token")

  const logout = useCallback(() => {
    localStorage.removeItem("admin_token")
    window.location.href = "/dashboard/login"
  }, [])

  return { token, logout }
}
