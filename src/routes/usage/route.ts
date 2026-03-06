import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { trafficControlManager } from "~/lib/traffic-control"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

export const usageRoute = new Hono()

usageRoute.get("/", async (c) => {
  let lease: Awaited<ReturnType<typeof trafficControlManager.acquire>> | null =
    null
  try {
    lease = await trafficControlManager.acquire("/usage")
    const usage = await getCopilotUsage()
    return c.json(usage)
  } catch (error) {
    return await forwardError(c, error)
  } finally {
    lease?.release()
  }
})
