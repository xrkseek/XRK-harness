import { describe, expect, it } from 'vitest'
import {
  billedInputTokens,
  cacheHitPercent,
  contextBreakdownForMeter,
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
    // DSH: hit = read / (uncached + read + write).
    expect(cacheHitPercent({
      uncachedInputTokens: 10,
      outputTokens: 7,
      cacheReadTokens: 90,
      cacheWriteTokens: 100,
    })).toBe('45')
  })

  it('computes context occupancy only when both numerator and capacity are known', () => {
    // Prefer projectedTokens when both are present (DSH context-occupancy).
    expect(contextOccupancy({ pressureTokens: 32_000, projectedTokens: 6_000, contextWindow: 128_000 }))
      .toEqual({ percent: 5, usedTokens: 6_000, contextWindow: 128_000, approximate: false })
    expect(contextOccupancy({ pressureTokens: 32_000, contextWindow: 128_000 }))
      .toEqual({ percent: 25, usedTokens: 32_000, contextWindow: 128_000, approximate: false })
    expect(contextOccupancy({ pressureTokens: 32_000 })).toBeNull()
    expect(contextOccupancy({ contextWindow: 128_000 })).toBeNull()
    expect(contextOccupancy(undefined)).toBeNull()
    expect(contextOccupancy({ pressureTokens: 300_000, contextWindow: 128_000 })?.percent).toBe(100)
    // No usage sample — heuristic breakdown fills an approximate ring.
    expect(contextOccupancy(
      { contextWindow: 262_144 },
      { systemTokens: 2_800, toolsTokens: 11_700, messageTokens: 121_000 },
    )).toEqual({
      percent: 52,
      usedTokens: 135_500,
      contextWindow: 262_144,
      approximate: true,
    })
  })

  it('fills messages so meter rows sum to the provider ring', () => {
    expect(contextBreakdownForMeter(
      { systemTokens: 2_800, toolsTokens: 11_700, messageTokens: 121_000 },
      210_000,
    )).toEqual({
      systemTokens: 2_800,
      toolsTokens: 11_700,
      messageTokens: 195_500,
      residualTokens: 74_500,
    })
    // Ring smaller than system+tools → keep raw heuristic (no clamp).
    expect(contextBreakdownForMeter(
      { systemTokens: 120, toolsTokens: 21_500, messageTokens: 477_000 },
      3_000,
    )).toEqual({
      systemTokens: 120,
      toolsTokens: 21_500,
      messageTokens: 477_000,
      residualTokens: 0,
    })
  })
})
