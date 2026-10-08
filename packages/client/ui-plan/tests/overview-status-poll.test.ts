import { describe, expect, it } from 'vitest'
import { overviewStatusPollMs } from '../src/client/overview-status-poll.ts'

describe('overviewStatusPollMs', () => {
  it('uses a quiet idle base and a responsive busy base', () => {
    expect(overviewStatusPollMs(false, 0)).toBe(5_000)
    expect(overviewStatusPollMs(true, 0)).toBe(1_200)
  })

  it('stretches when the last Face load was slow, capped per mode', () => {
    expect(overviewStatusPollMs(false, 500)).toBe(5_000) // still under 2× base floor via max(base, …)
    expect(overviewStatusPollMs(false, 3_000)).toBe(6_000)
    expect(overviewStatusPollMs(false, 20_000)).toBe(15_000)
    expect(overviewStatusPollMs(true, 3_000)).toBe(6_000)
    expect(overviewStatusPollMs(true, 20_000)).toBe(8_000)
  })
})
