// @vitest-environment jsdom
/**
 * Kernel boot stamp: hide body-portaled workbench chrome during splash.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BOOTING_ATTR, clearBooting, stampBooting } from '../src/boot-stamp.ts'

afterEach(() => {
  clearBooting()
  document.documentElement.removeAttribute('lang')
})

describe('boot-stamp', () => {
  it('stamps and clears data-xrk-booting on <html>', () => {
    stampBooting('en')
    expect(document.documentElement.hasAttribute(BOOTING_ATTR)).toBe(true)
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    stampBooting('zh')
    expect(document.documentElement.getAttribute('lang')).toBe('zh-CN')
    clearBooting()
    expect(document.documentElement.hasAttribute(BOOTING_ATTR)).toBe(false)
  })
})
