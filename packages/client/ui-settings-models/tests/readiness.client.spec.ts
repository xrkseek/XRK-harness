/** Pure Models-page provider readiness helpers. */
import { describe, expect, it } from 'vitest'
import type { CredentialView } from '@xrkseek/xrk-api-remotes/client'
import type { ProviderRow } from '../src/client/store.ts'
import { providerUsable } from '../src/client/store.ts'

const missingCredential: CredentialView = { configured: false, writable: true }

/** A configured pi-ai route the user added themselves. */
function otherRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'hfai',
      displayName: 'HFAI',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'hfai'],
      active: true,
    },
    configured: true,
    removable: true,
    apiKeyEnv: 'HFAI_API_KEY',
    credential: { configured: true, source: 'file', writable: true },
    ...overrides,
  }
}

describe('providerUsable', () => {
  it('requires a registered route and a stored key for every named reference', () => {
    expect(providerUsable(otherRow())).toBe(true)
    expect(providerUsable(otherRow({ entry: { ...otherRow().entry, active: false } }))).toBe(false)
    expect(providerUsable(otherRow({ credential: missingCredential }))).toBe(false)
    expect(providerUsable(otherRow({ credential: undefined }))).toBe(false)
  })

  it('treats a reference-free registered route as provider-native authentication', () => {
    expect(providerUsable(otherRow({ apiKeyEnv: undefined, credential: undefined }))).toBe(true)
  })

  it('treats dormant (unconfigured) directory rows as not usable', () => {
    expect(providerUsable(otherRow({
      configured: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }))).toBe(false)
  })
})
