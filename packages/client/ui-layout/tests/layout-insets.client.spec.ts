// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { LayoutController } from '../src/client/service.ts'
import {
  applyLayoutInsetsDom,
  clearLayoutInsetsDom,
  EMPTY_LAYOUT_INSETS,
  LAYOUT_INSET_ATTR,
  LAYOUT_INSET_CSS,
  layoutInsetsEqual,
  resolveWorkbenchBottomForPublish,
  shellOccupiedWidth,
} from '../src/client/layout-insets.ts'
import { XRK_WORKBENCH_CSS } from '../src/client/dsh-style-aliases.ts'

afterEach(() => {
  clearLayoutInsetsDom()
})

describe('layout insets contract', () => {
  it('writes CSS variables and attributes on documentElement', () => {
    applyLayoutInsetsDom({ details: 360, detailsOpen: true, sidebar: 280, bottom: 0, phone: false })
    const root = document.documentElement
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('360px')
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.sidebar)).toBe('280px')
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.details)).toBe(true)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.detailsOpen)).toBe(true)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.phone)).toBe(false)

    // Phone Overview: details px stays 0, detailsOpen still stamps.
    applyLayoutInsetsDom({ details: 0, detailsOpen: true, sidebar: 56, bottom: 180, phone: true })
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('0px')
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.bottom)).toBe('180px')
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.details)).toBe(false)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.detailsOpen)).toBe(true)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.phone)).toBe(true)

    clearLayoutInsetsDom()
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('')
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.phone)).toBe(false)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.detailsOpen)).toBe(false)
  })

  it('LayoutController publishes insets for ctx.layout consumers', () => {
    const layout = new LayoutController()
    expect(layout.insets.getSnapshot()).toEqual(EMPTY_LAYOUT_INSETS)
    const seen: number[] = []
    const off = layout.insets.subscribe(() => {
      seen.push(layout.insets.getSnapshot().details)
    })
    layout.publishInsets({ details: 360, detailsOpen: true, sidebar: 280, phone: false })
    expect(layout.insets.getSnapshot().details).toBe(360)
    expect(layout.insets.getSnapshot().detailsOpen).toBe(true)
    expect(layout.insets.getSnapshot().bottom).toBe(0)
    expect(document.documentElement.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('360px')
    layout.reserveBottom(220)
    expect(layout.insets.getSnapshot().bottom).toBe(220)
    layout.publishInsets({ details: 400, detailsOpen: true, sidebar: 280, phone: false })
    expect(layout.insets.getSnapshot().bottom).toBe(220)
    layout.publishInsets({ details: 360, detailsOpen: false, sidebar: 280, phone: false })
    expect(layout.insets.getSnapshot().detailsOpen).toBe(false)
    layout.clearInsets()
    expect(layout.insets.getSnapshot()).toEqual(EMPTY_LAYOUT_INSETS)
    off()
    expect(seen).toEqual([360, 360, 400, 360, 0])
  })

  it('layoutInsetsEqual compares fields', () => {
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, {
      details: 0, detailsOpen: false, sidebar: 0, bottom: 0, phone: false,
    })).toBe(true)
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, {
      details: 1, detailsOpen: false, sidebar: 0, bottom: 0, phone: false,
    })).toBe(false)
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, {
      details: 0, detailsOpen: true, sidebar: 0, bottom: 0, phone: false,
    })).toBe(false)
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, {
      details: 0, detailsOpen: false, sidebar: 0, bottom: 1, phone: false,
    })).toBe(false)
  })

  it('shellOccupiedWidth sums rail + Overview only', () => {
    expect(shellOccupiedWidth({ sidebar: 240, details: 360 })).toBe(600)
    expect(shellOccupiedWidth({ sidebar: 56, details: 0 })).toBe(56)
    expect(shellOccupiedWidth({ sidebar: -1, details: Number.NaN })).toBe(0)
  })

  it('resolveWorkbenchBottomForPublish preserves when CSS unset; honors explicit 0', () => {
    expect(resolveWorkbenchBottomForPublish('')).toEqual({ preserve: true })
    expect(resolveWorkbenchBottomForPublish('   ')).toEqual({ preserve: true })
    expect(resolveWorkbenchBottomForPublish('0px')).toEqual({ bottom: 0 })
    expect(resolveWorkbenchBottomForPublish('220px')).toEqual({ bottom: 220 })
  })

  it('reserveBottom alone survives a column republish that omits bottom', () => {
    const layout = new LayoutController()
    layout.publishInsets({ details: 360, detailsOpen: true, sidebar: 280, phone: false })
    layout.reserveBottom(180)
    expect(layout.insets.getSnapshot().bottom).toBe(180)
    expect(document.documentElement.style.getPropertyValue(XRK_WORKBENCH_CSS.height)).toBe('180px')
    expect(document.documentElement.style.getPropertyValue(LAYOUT_INSET_CSS.bottom)).toBe('180px')
    // AppFrame column tick: CSS still present → same bottom; then simulate
    // a CSS-cleared frame that must preserve via omit.
    layout.publishInsets({ details: 400, detailsOpen: true, sidebar: 280, phone: false })
    expect(layout.insets.getSnapshot().bottom).toBe(180)
    document.documentElement.style.removeProperty(XRK_WORKBENCH_CSS.height)
    const resolved = resolveWorkbenchBottomForPublish(
      document.documentElement.style.getPropertyValue(XRK_WORKBENCH_CSS.height),
    )
    expect(resolved).toEqual({ preserve: true })
    layout.publishInsets({ details: 320, detailsOpen: false, sidebar: 240, phone: false })
    expect(layout.insets.getSnapshot().bottom).toBe(180)
    layout.reserveBottom(0)
    expect(layout.insets.getSnapshot().bottom).toBe(0)
    layout.clearInsets()
  })

  it('reserveSide stamps workbench width for shell frame yield', () => {
    const layout = new LayoutController()
    layout.reserveSide(320)
    expect(document.documentElement.style.getPropertyValue(XRK_WORKBENCH_CSS.width)).toBe('320px')
    layout.reserveSide(0)
    expect(document.documentElement.style.getPropertyValue(XRK_WORKBENCH_CSS.width)).toBe('0px')
    layout.clearInsets()
    expect(document.documentElement.style.getPropertyValue(XRK_WORKBENCH_CSS.width)).toBe('')
  })
})
