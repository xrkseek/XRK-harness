// @vitest-environment jsdom
/**
 * Kernel boot stamp: hide body-portaled workbench chrome during splash.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BOOTING_ATTR, clearBooting, stampBooting } from '../src/boot-stamp.ts'

beforeEach(() => {
  document.body.innerHTML = '<div id="xrk-boot-skeleton"></div>'
})

afterEach(() => {
  clearBooting()
  document.documentElement.removeAttribute('lang')
  document.body.innerHTML = ''
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

  it('keeps the critical skeleton visible until clearBooting', () => {
    const skeleton = document.getElementById('xrk-boot-skeleton')
    expect(skeleton).not.toBeNull()
    skeleton!.setAttribute('hidden', '')
    stampBooting('en')
    expect(skeleton!.hasAttribute('hidden')).toBe(false)
    clearBooting()
    expect(skeleton!.hasAttribute('hidden')).toBe(true)
  })
})
