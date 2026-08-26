import { describe, expect, it, vi } from 'vitest'
import { randomUuid } from '@xrkseek/xrk-host-apiproxy/api'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  it('delegates to crypto.randomUUID when available', () => {
    const native = vi.fn(() => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    vi.stubGlobal('crypto', {
      randomUUID: native,
      getRandomValues: vi.fn(),
    })
    try {
      expect(randomUuid()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
      expect(native).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to getRandomValues when randomUUID is missing (insecure HTTP)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes[0] = 0x11
        bytes[1] = 0x22
        bytes[15] = 0xff
        return bytes
      },
    })
    try {
      expect(randomUuid()).toMatch(UUID_V4)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws when neither randomUUID nor getRandomValues exists', () => {
    vi.stubGlobal('crypto', {})
    try {
      expect(() => randomUuid()).toThrow(/getRandomValues is unavailable/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
