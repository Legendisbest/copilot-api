import { describe, expect, test } from "bun:test"

import { HTTPError } from "../src/lib/error"
import {
  buildTrafficControlSettings,
  TrafficControlManager,
} from "../src/lib/traffic-control"

describe("traffic control", () => {
  test("buildTrafficControlSettings applies env and legacy overrides", () => {
    const settings = buildTrafficControlSettings(
      {
        global_max_requests_per_hour: "25",
      },
      {
        env: {
          TRAFFIC_CONTROL_ENABLED: "true",
          GLOBAL_MIN_DELAY_MS: "500",
          GLOBAL_QUEUE_ENABLED: "true",
        },
        legacy: {
          minDelayMs: 2_000,
          queueEnabled: false,
        },
      },
    )

    expect(settings.enabled).toBe(true)
    expect(settings.minDelayMs).toBe(2_000)
    expect(settings.queueEnabled).toBe(false)
    expect(settings.maxRequestsPerHour).toBe(25)
  })

  test("rejects immediately when queueing is disabled", async () => {
    const manager = new TrafficControlManager()
    manager.setSettingsForTest({
      enabled: true,
      minDelayMs: 50,
      queueEnabled: false,
    })

    const lease = await manager.acquire("/chat/completions")

    try {
      let error: unknown = null

      try {
        await manager.acquire("/chat/completions")
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(HTTPError)
      expect((error as HTTPError).response.status).toBe(429)
    } finally {
      lease.release()
    }
  })

  test("waits for queue and min delay before starting the next request", async () => {
    const manager = new TrafficControlManager()
    manager.setSettingsForTest({
      enabled: true,
      minDelayMs: 30,
      delayJitterMs: 0,
      maxConcurrentRequests: 1,
      queueEnabled: true,
      maxQueueSize: 10,
      maxQueueWaitMs: 1_000,
    })

    const startedAt = Date.now()
    const firstLease = await manager.acquire("/responses")
    const secondLeasePromise = manager.acquire("/responses")

    await Bun.sleep(10)
    firstLease.release()

    const secondLease = await secondLeasePromise

    try {
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25)
    } finally {
      secondLease.release()
    }
  })
})
