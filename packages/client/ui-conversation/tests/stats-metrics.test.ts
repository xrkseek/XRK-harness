import { describe, expect, it } from 'vitest'
import {
  billedInputTokens,
  cacheHitPercent,
  contextOccupancy,
  formatDuration,
  formatTokens,
} from '../src/client/chat/stats-metrics.ts'

describe('stats-metrics', () => {
  it('formats compact tokens', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_240)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_230_000)).toBe('1.2M')
  })

  it('formats compact durations through the locale seat', () => {
    const tEn = (key: string, params: Record<string, string | number>) => {
      if (key === 'duration.compactSeconds') return `${params.seconds}s`
      return `${params.minutes}m${params.seconds}s`
    }
    expect(formatDuration(45_230, tEn)).toBe('45.2s')
    expect(formatDuration(162_000, tEn)).toBe('2m42s')
  })

  it('computes cache-hit and billed input from tokenUsage buckets', () => {
    expect(cacheHitPercent({
      uncachedInputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 90,
      cacheWriteTokens: 0,
    })).toBe('90')
    expect(billedInputTokens({
      uncachedInputTokens: 10,
      outputTokens: 7,
      cacheReadTokens: 90,
      cacheWriteTokens: 100,
    })).toBe(200)
    expect(cacheHitPercent({
      uncachedInputTokens: 10,
      outputTokens: 7,
      cacheReadTokens: 90,
      cacheWriteTokens: 100,
    })).toBe('45')
  })

  it('computes context occupancy only when both numerator and capacity are known', () => {
    expect(contextOccupancy({ pressureTokens: 32_000, projectedTokens: 6_000, contextWindow: 128_000 }))
      .toEqual({ percent: 5, usedTokens: 6_000, contextWindow: 128_000 })
    expect(contextOccupancy({ pressureTokens: 32_000 })).toBeNull()
    expect(contextOccupancy(undefined)).toBeNull()
  })
})
