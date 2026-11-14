import { describe, expect, it } from 'vitest'
import {
  canOfferPluginUpdate,
  classifyPluginSource,
  isNpmVersionNewer,
  isPhoneGuestEngineEntry,
  shouldShowPluginUpdateBadge,
} from '../src/client/plugin-source.ts'

describe('plugin-source helpers', () => {
  it('detects phone-guest engine rows', () => {
    expect(isPhoneGuestEngineEntry({ entryId: 'xrk-mobile', source: 'phone-guest' })).toBe(true)
    expect(isPhoneGuestEngineEntry({ entryId: 'xrk-mobile-ui' })).toBe(true)
    expect(isPhoneGuestEngineEntry({
      entryId: 'xrkh-better-sidebar',
      source: 'xrkh-better-sidebar@0.18.2',
    })).toBe(false)
  })

  it('classifies sources for update menu', () => {
    expect(classifyPluginSource({ entryId: 'p', source: 'file:./x' })).toBe('local')
    expect(classifyPluginSource({ entryId: 'p', source: 'github:o/r' })).toBe('vcs')
    expect(classifyPluginSource({ entryId: 'p', source: 'pkg@1.0.0' })).toBe('registry')
    expect(canOfferPluginUpdate('local')).toBe(false)
    expect(canOfferPluginUpdate('registry')).toBe(true)
    expect(canOfferPluginUpdate('vcs')).toBe(true)
  })

  it('compares semver cores for badge gating', () => {
    expect(isNpmVersionNewer('0.1.2', '0.1.1')).toBe(true)
    expect(isNpmVersionNewer('0.1.2', '0.1.2')).toBe(false)
    expect(isNpmVersionNewer('0.1.1', '0.1.2')).toBe(false)
  })

  it('hides update badge when probe latest matches installed', () => {
    expect(shouldShowPluginUpdateBadge({
      updateAvailable: true,
      latest: '0.1.2',
      installed: '0.1.2',
    })).toBe(false)
    expect(shouldShowPluginUpdateBadge({
      updateAvailable: true,
      latest: '0.20.11',
      installed: '0.20.10',
    })).toBe(true)
    expect(shouldShowPluginUpdateBadge({
      updateAvailable: false,
      latest: '0.20.11',
      installed: '0.20.10',
    })).toBe(false)
  })
})
