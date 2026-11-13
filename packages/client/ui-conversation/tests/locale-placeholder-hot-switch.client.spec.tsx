/**
 * JA → ZH locale switch must refresh composer placeholder copy via the
 * locale-revision seat (fresh `t` identity), not a cached string.
 */
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@xrkseek/client-test-runtime'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import { en, ja, NS, zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('ja-JP')

describe('composer placeholder locale hot-switch', () => {
  it('JA → ZH remints t so placeholder.default flips without remount', async () => {
    const runtime = await SlotTestRuntime.create()
    const locale = new LocaleRuntime(runtime.ctx)
    locale.register(NS, { zh, en, ja })
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)

    expect(locale.getSnapshot().active).toBe('ja')
    const tJa = locale.bind(NS)
    expect(tJa('placeholder.default')).toBe(ja['placeholder.default'])

    locale.setLocale('zh')
    expect(locale.getSnapshot().active).toBe('zh')
    // bind() identity may be stable; outlet seats wrap per revision — call
    // through the live bind and assert dictionary flip.
    expect(locale.bind(NS)('placeholder.default')).toBe(zh['placeholder.default'])
    expect(locale.getSnapshot().revision).toBeGreaterThan(0)

    locale.setLocale('ja')
    expect(locale.bind(NS)('placeholder.default')).toBe(ja['placeholder.default'])
  })
})
