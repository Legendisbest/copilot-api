export interface CorsRuntimeConfig {
  allowCredentials: boolean
  allowedOrigins: Array<string>
  openToAllOrigins: boolean
}

const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (value === undefined) return fallback

  const normalized = value.trim().toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false

  return fallback
}

const parseDelimitedList = (value: string | undefined): Array<string> => {
  if (!value) return []

  return [
    ...new Set(
      value
        .replaceAll("\n", ",")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ]
}

export function getCorsRuntimeConfig(): CorsRuntimeConfig {
  const allowedOrigins = parseDelimitedList(process.env.CORS_ALLOWED_ORIGINS)
  const openToAllOrigins =
    allowedOrigins.length === 0 || allowedOrigins.includes("*")

  return {
    allowCredentials: parseBoolean(process.env.CORS_ALLOW_CREDENTIALS, false),
    allowedOrigins: openToAllOrigins ? [] : allowedOrigins,
    openToAllOrigins,
  }
}

export function getCorsOptions() {
  const runtimeConfig = getCorsRuntimeConfig()

  if (runtimeConfig.openToAllOrigins) {
    return {
      origin: "*",
    }
  }

  const fallbackOrigin = runtimeConfig.allowedOrigins[0]

  return {
    origin: (origin: string) => {
      if (runtimeConfig.allowedOrigins.includes(origin)) {
        return origin
      }
      return fallbackOrigin
    },
    credentials: runtimeConfig.allowCredentials,
  }
}
