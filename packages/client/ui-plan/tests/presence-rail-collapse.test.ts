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

  it('collapsed delegate stack paints lead only (no overlapping compact chips)', () => {
    const block = cssBlock(
      previewCss,
      '.delegatePair[data-collapsed] .delegateFromLayer:not([data-lead])',
    )
    expect(block).toMatch(/display:\s*none/)
  })
})

describe('delegate stack overlap', () => {
  it('keeps pair-stage shape via CSS scale (not compact chip mounts)', () => {
    expect(previewCss).toMatch(
      /\.delegateFromLayer\[data-depth='1'\][\s\S]*?transform:\s*scale\(0\.86\)/,
    )
    expect(previewCss).toMatch(
      /\.delegateFromLayer\[data-depth='3'\][\s\S]*?transform:\s*scale\(0\.68\)/,
    )
  })

  it('fans peeks with fixed stage width so behind balls never flex-shrink away', () => {
    expect(previewCss).toMatch(/flex:\s*0\s+0\s+auto/)
    expect(previewCss).toMatch(
      /margin-right:\s*calc\(var\(--xrk-delegate-stage,\s*118px\)\s*\*\s*-0\.56\)/,
    )
    expect(previewCss).toMatch(
      /padding-left:\s*calc\(var\(--xrk-delegate-stage,\s*118px\)\s*\*\s*0\.42\)/,
    )
    // Equal seat tracks — never reintroduce 1.35fr left bias.
    expect(previewCss).toMatch(
      /\.delegatePair\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/,
    )
    expect(previewCss).not.toMatch(/minmax\(0,\s*1\.35fr\)/)
    expect(previewCss).not.toMatch(/minmax\(0,\s*1\.3fr\)/)
    expect(previewCss).not.toMatch(/margin-right:\s*-55%/)
    expect(previewCss).not.toMatch(/margin-right:\s*-64%/)
  })

  it('keeps the 委派 arrow above the left fan', () => {
    const block = cssBlock(previewCss, '.delegateArrow')
    expect(block).toMatch(/z-index:\s*6/)
    expect(previewCss).toMatch(/\.delegateFromStack\s*\{[^}]*overflow:\s*hidden/)
  })

  it('keeps boss peeks clickable when a 干员 is the recent lead', () => {
    expect(previewCss).toMatch(
      /\.delegateFromLayer:not\(\[data-lead\]\)\[data-boss\][\s\S]*?pointer-events:\s*auto/,
    )
  })

  it('solo lead stays on the shared stage cap (not width:100% of a biased track)', () => {
    const block = cssBlock(previewCss, ".delegateFromStack[data-count='1'] .delegateFromLayer")
    expect(block).toMatch(/width:\s*min\(100%,\s*var\(--xrk-delegate-stage/)
    expect(block).toMatch(/flex:\s*0\s+0\s+auto/)
    // Reject bare `width: 100%` (old fill-the-1.35fr-track rule), not max-width.
    expect(block).not.toMatch(/(^|[\s;])width:\s*100%/)
    expect(block).not.toMatch(/flex:\s*1\s+1\s+auto/)
  })

  it('solo lead never keeps a peek left gutter (desktop + phone)', () => {
    expect(previewCss).toMatch(
      /\.delegateFromStack\[data-count='1'\]\s*\{[^}]*padding-left:\s*0/,
    )
    expect(previewCss).toMatch(
      /html\[data-xrk-layout-phone\]\)\s*\.delegateFromStack\[data-count='1'\]\s*\{[^}]*padding-left:\s*0/,
    )
    // Phone peek pad must be gated — a bare .delegateFromStack override used
    // to reintroduce empty air beside 老板 on full-bleed Overview.
    expect(previewCss).toMatch(
      /html\[data-xrk-layout-phone\]\)\s*\.delegateFromStack:not\(\[data-count='1'\]\)\s*\{[^}]*padding-left:/,
    )
  })

  it('right seat hugs the arrow with the same stage cap as the lead', () => {
    expect(previewCss).toMatch(
      /\.delegateToSeat\s*\{[^}]*justify-content:\s*flex-start/,
    )
    expect(previewCss).toMatch(
      /\.delegateToSeat\s*>\s*\*\s*\{[^}]*width:\s*min\(100%,\s*var\(--xrk-delegate-stage/,
    )
  })

  it('publishes a shared stage reference that shrinks with stack count', () => {
    expect(previewCss).toMatch(/--xrk-delegate-stage:\s*118px/)
    expect(previewCss).toMatch(
      /\.delegatePair\[data-stack-count='2'\]\s*\{[^}]*--xrk-delegate-stage:\s*100px/,
    )
    expect(previewCss).toMatch(
      /\.delegatePair\[data-stack-count='3'\][\s\S]*?--xrk-delegate-stage:\s*88px/,
    )
  })

  it('N-stack layers pin stage width so peeks and lead stay isometric', () => {
    expect(previewCss).toMatch(
      /\.delegateFromLayer\s*\{[^}]*width:\s*min\(100%,\s*var\(--xrk-delegate-stage/,
    )
  })
})

describe('phone pair stage floor', () => {
  it('pair stages read --xrk-delegate-stage so L/R stay isometric', () => {
    expect(ballCss).toMatch(
      /\[data-pair\]:not\(\[data-compact\]\)\s*\.stage\s*\{[^}]*var\(--xrk-delegate-stage/,
    )
    expect(ballCss).not.toMatch(
      /\[data-pair\]:not\(\[data-compact\]\)\s*\.stage\s*\{[^}]*width:\s*132px/,
    )
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
