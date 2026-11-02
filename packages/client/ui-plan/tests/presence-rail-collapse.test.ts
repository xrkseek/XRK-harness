import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The Overview presence rail is mounted even while its details pane is collapsed
 * to width 0 (so expanding cannot insert a tall ball and shove Status). That
 * only works if the collapsed rail never paints: a `visibility: visible` rail
 * under a 0-wide `overflow: visible` aside leaked the delegate pair outside the
 * pane and the crushed grid sliced both stages into 1px strips — the "green
 * blob / grey bracket" folded overview.
 *
 * These are CSS contracts, not behaviour tests: jsdom does no layout, so the
 * only honest guard is pinning the two rules that keep the collapse silent.
 */
function cssBlock(source: string, selector: string): string {
  const at = source.indexOf(selector)
  if (at < 0) throw new Error(`missing selector: ${selector}`)
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

const previewCss = readFileSync(
  new URL('../src/client/PreviewTabs.module.css', import.meta.url),
  'utf8',
)
const ballCss = readFileSync(
  new URL('../src/client/PresenceBall.module.css', import.meta.url),
  'utf8',
)

describe('collapsed overview presence rail', () => {
  it('hides the mounted rail instead of painting it outside the 0-wide pane', () => {
    const block = cssBlock(previewCss, ".presenceRail[aria-hidden='true']")
    expect(block).toMatch(/visibility:\s*hidden/)
  })

  it('keeps the rail in layout when hidden (no display: none jump on expand)', () => {
    const block = cssBlock(previewCss, ".presenceRail[aria-hidden='true']")
    expect(block).not.toMatch(/display:\s*none/)
  })
})

describe('presence ball mount geometry', () => {
  it('centres the bitmap box so a size trim grows evenly', () => {
    const block = cssBlock(ballCss, '.mount {')
    expect(block).toMatch(/left:\s*50%/)
    expect(block).toMatch(/top:\s*50%/)
    expect(block).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/)
    expect(block).toMatch(/width:\s*calc\(83\.3333%\s*\*\s*var\(--ball-size,\s*1\)\)/)
  })

  /* A compact override that reintroduces left/right/top/bottom would shift the
   * box by half its own size on top of the centring transform — the exact way
   * the pair shipped a cropped corner instead of a ball. */
  it('never offsets the compact mount with inset edges', () => {
    const matches = [...ballCss.matchAll(/\.root\[data-compact\][^{]*\.mount\s*\{([^}]*)\}/g)]
    expect(matches.length).toBeGreaterThan(0)
    for (const [, block] of matches) {
      expect(block ?? '').not.toMatch(/(^|[\s;{])(left|right|top|bottom)\s*:/)
    }
  })
})
