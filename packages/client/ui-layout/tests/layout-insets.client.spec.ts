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
} from '../src/client/layout-insets.ts'

afterEach(() => {
  clearLayoutInsetsDom()
})

describe('layout insets contract', () => {
  it('writes CSS variables and attributes on documentElement', () => {
    applyLayoutInsetsDom({ details: 360, sidebar: 280, bottom: 0, phone: false })
    const root = document.documentElement
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('360px')
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.sidebar)).toBe('280px')
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.details)).toBe(true)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.phone)).toBe(false)

    applyLayoutInsetsDom({ details: 0, sidebar: 56, bottom: 180, phone: true })
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('0px')
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.bottom)).toBe('180px')
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.details)).toBe(false)
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.phone)).toBe(true)

    clearLayoutInsetsDom()
    expect(root.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('')
    expect(root.hasAttribute(LAYOUT_INSET_ATTR.phone)).toBe(false)
  })

  it('LayoutController publishes insets for ctx.layout consumers', () => {
    const layout = new LayoutController()
    expect(layout.insets.getSnapshot()).toEqual(EMPTY_LAYOUT_INSETS)
    const seen: number[] = []
    const off = layout.insets.subscribe(() => {
      seen.push(layout.insets.getSnapshot().details)
    })
    layout.publishInsets({ details: 360, sidebar: 280, phone: false })
    expect(layout.insets.getSnapshot().details).toBe(360)
    expect(layout.insets.getSnapshot().bottom).toBe(0)
    expect(document.documentElement.style.getPropertyValue(LAYOUT_INSET_CSS.details)).toBe('360px')
    layout.reserveBottom(220)
    expect(layout.insets.getSnapshot().bottom).toBe(220)
    layout.publishInsets({ details: 400, sidebar: 280, phone: false })
    expect(layout.insets.getSnapshot().bottom).toBe(220)
    layout.publishInsets({ details: 360, sidebar: 280, phone: false })
    layout.clearInsets()
    expect(layout.insets.getSnapshot()).toEqual(EMPTY_LAYOUT_INSETS)
    off()
    expect(seen).toEqual([360, 360, 400, 360, 0])
  })

  it('layoutInsetsEqual compares fields', () => {
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, { details: 0, sidebar: 0, bottom: 0, phone: false })).toBe(true)
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, { details: 1, sidebar: 0, bottom: 0, phone: false })).toBe(false)
    expect(layoutInsetsEqual(EMPTY_LAYOUT_INSETS, { details: 0, sidebar: 0, bottom: 1, phone: false })).toBe(false)
  })
})
