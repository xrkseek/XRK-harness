// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@xrkseek/client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)
const glyphCount = Object.keys(primitives.ICON_ARTWORK).length

describe('product icon set', () => {
  it('gives every glyph a regular and a medium component', () => {
    // One glyph in the artwork table is reserved for composite artwork and is
    // not exposed on its own, so callers see (glyphs - 1) × 2 components.
    expect(iconNames).toHaveLength(2 * (glyphCount - 1))
    for (const name of iconNames.filter(candidate => candidate.endsWith('Regular'))) {
      expect(iconNames).toContain(name.replace(/Regular$/, 'Medium'))
    }
  })

  it('publishes one default sprite symbol per glyph and weight', () => {
    expect(Object.keys(primitives.ICON_SYMBOLS)).toHaveLength(2 * glyphCount)
  })

  it('keeps element ids unique inside every symbol', () => {
    // A repeated id would make one glyph's gradient/clip leak into another's.
    const ids = Object.values(primitives.ICON_SYMBOLS)
      .flatMap(markup => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders a sprite reference, not an inlined path', () => {
    const { container } = render(<primitives.IconSearchOutlineMedium />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('data-icon')).toBe('dsw-icon-search-outline-medium')
    expect(container.querySelector('use')!.getAttribute('href')).toBe('#dsw-icon-search-outline-medium')
    // The artwork lives in the sprite; the use site carries no path of its own.
    expect(container.querySelector('path')).toBeNull()
  })

  it('uses 1px regular and 1.3px medium strokes', () => {
    expect(primitives.ICON_REGULAR_STROKE).toBe(1)
    expect(primitives.ICON_MEDIUM_STROKE).toBe(1.3)
    expect(primitives.ICON_SYMBOLS['dsw-icon-search-outline-regular'])
      .toBe(primitives.ICON_ARTWORK['search-outline'].svg(primitives.ICON_REGULAR_STROKE))
    expect(primitives.ICON_SYMBOLS['dsw-icon-search-outline-medium'])
      .toBe(primitives.ICON_ARTWORK['search-outline'].svg(primitives.ICON_MEDIUM_STROKE))
  })

  it('keeps every default glyph free of a hardcoded palette', () => {
    for (const markup of Object.values(primitives.ICON_SYMBOLS)) {
      expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
      expect(markup).toContain('currentColor')
    }
  })

  it('keeps a non-square glyph at its drawn ratio', () => {
    const { container } = render(<primitives.IconTreeCornerRegular size={20} />)
    const svg = container.querySelector('svg')!
    // aspect [8, 10]: width follows the ratio, height stays the requested size.
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.getAttribute('width')).toBe('16')
  })

  it('defaults each glyph to its own drawn size', () => {
    const search = render(<primitives.IconSearchOutlineRegular />)
    expect(search.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const globe = render(<primitives.IconGlobeOutlineRegular />)
    expect(globe.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const corner = render(<primitives.IconTreeCornerRegular />)
    expect(corner.container.querySelector('svg')!.getAttribute('height')).toBe('10')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<primitives.IconSendOutlineRegular size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('ships the bell glyph XRK adds on top of the DSH artwork table', () => {
    expect(primitives.ICON_ARTWORK['bell-outline']).toBeDefined()
    const { container } = render(<primitives.IconBellOutlineRegular />)
    expect(container.querySelector('use')!.getAttribute('href')).toBe('#dsw-icon-bell-outline-regular')
  })
})

describe('BrandMark', () => {
  it('renders the plate-traced XRK mark at a square ratio', () => {
    const { container } = render(<primitives.BrandMark />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('height')).toBe('24')
    expect(svg.getAttribute('viewBox')).toBe('0 0 348 348')
    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).toContain('#eab039')
  })
})
