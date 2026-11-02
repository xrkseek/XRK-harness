#!/usr/bin/env node
/**
 * Generate `packages/client/ui-workspace/src/client/shape-glyphs.ts` from the
 * engine's real silhouettes.
 *
 * Why: the shape picker used to hand-draw a second set of SVG paths, so the
 * button glyph and the ball could disagree (cloud looked like a cloud while the
 * engine rendered a star). Now the glyph IS the engine ring, normalised.
 *
 *   node scripts/gen-shape-glyphs.mjs            # write the table
 *   node scripts/gen-shape-glyphs.mjs --check    # exit 1 if the table drifts
 *
 * Source of truth: apps/web/public/presence/emotion-ball/rings.js → SHAPES[id].ring
 * Output: one `M…L…Z` path per shape, 36×36 viewBox, 2px margin, ~40 points.
 *
 * The same run also mirrors `rings.js` → `BRANDS` into `brand-badges.ts`, so the
 * dressing picker previews the exact badge the engine draws (held slot).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RINGS = path.join(ROOT, 'apps/web/public/presence/emotion-ball/rings.js')
const OUT = path.join(ROOT, 'packages/client/ui-workspace/src/client/shape-glyphs.ts')
const BRAND_OUT = path.join(ROOT, 'packages/client/ui-workspace/src/client/brand-badges.ts')
const VIEW = 36
const MARGIN = 2
const TARGET_POINTS = 40

globalThis.EB_RINGS = undefined
// rings.js is a classic browser script (no ESM exports) — evaluate it as-is.
// eslint-disable-next-line no-new-func
new Function(readFileSync(RINGS, 'utf8'))()
const RD = globalThis.EB_RINGS
if (!RD?.SHAPES) throw new Error('rings.js did not define EB_RINGS.SHAPES')

const round = (n) => Math.round(n * 10) / 10
const trim = (n) => String(round(n)).replace(/\.0$/, '')

/** Ring → `M…L…Z`, uniformly scaled into a 36×36 box with a 2px margin. */
function toPath(ring) {
  if (!Array.isArray(ring) || ring.length < 3) throw new Error('bad ring')
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('non-finite ring point')
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const w = maxX - minX
  const h = maxY - minY
  const span = Math.max(w, h)
  if (span <= 0) throw new Error('degenerate ring')
  const inner = VIEW - MARGIN * 2
  const scale = inner / span
  const ox = (VIEW - w * scale) / 2
  const oy = (VIEW - h * scale) / 2
  const step = Math.max(1, Math.ceil(ring.length / TARGET_POINTS))
  const pts = []
  for (let i = 0; i < ring.length; i += step) {
    const [x, y] = ring[i]
    pts.push([round((x - minX) * scale + ox), round((y - minY) * scale + oy)])
  }
  if (pts.length < 3) throw new Error('ring collapsed')
  return 'M' + pts.map(([x, y]) => `${trim(x)} ${trim(y)}`).join('L') + 'Z'
}

const ids = Object.keys(RD.SHAPES)
const rows = ids.map((id) => [id, toPath(RD.SHAPES[id].ring)])
const seen = new Map()
for (const [id, d] of rows) {
  if (seen.has(d)) throw new Error(`duplicate glyph path: ${id} === ${seen.get(d)}`)
  seen.set(d, id)
}

const file = `/**
 * GENERATED FILE — do not edit by hand.
 * \`node scripts/gen-shape-glyphs.mjs\` rebuilds it from
 * \`apps/web/public/presence/emotion-ball/rings.js\` (SHAPES[id].ring), so the
 * picker glyph can never drift from the silhouette the engine actually draws.
 * 36×36 viewBox, 2px margin, ~${TARGET_POINTS} points per outline.
 */
export const SHAPE_GLYPHS: Record<string, string> = {
${rows.map(([id, d]) => `  '${id}':\n    '${d}',`).join('\n')}
}
`
const existing = (() => {
  try {
    return readFileSync(OUT, 'utf8')
  } catch {
    return ''
  }
})()

const brandIds = Object.keys(RD.BRANDS ?? {})
const brandFile = `/**
 * GENERATED FILE — do not edit by hand.
 * \`node scripts/gen-shape-glyphs.mjs\` rebuilds it from
 * \`apps/web/public/presence/emotion-ball/rings.js\` (BRANDS), so the picker mark
 * and the held badge the engine draws can never disagree.
 * Glyphs are 24×24 mono paths; brand trademarks stay with their owners.
 */
export type BrandBadge = {
  readonly label: string
  readonly color: string
  readonly path: string
  /** Optional second path on the same 24×24 grid (two-tone brands, e.g. XRK's gold drop). */
  readonly accent?: string
  readonly accentColor?: string
  /** Main glyph fill; only dark-badge brands need to override the white default. */
  readonly glyphColor?: string
}

export const BRAND_BADGES: Record<string, BrandBadge> = {
${brandIds
  .map((id) => {
    const b = RD.BRANDS[id]
    if (!b?.color || !b?.path) throw new Error(`bad brand entry: ${id}`)
    const extra = [
      b.accent ? `    accent:\n      '${b.accent}',` : '',
      b.accentColor ? `    accentColor: '${b.accentColor}',` : '',
      b.glyphColor ? `    glyphColor: '${b.glyphColor}',` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return `  '${id}': {\n    label: '${b.label}',\n    color: '${b.color}',\n    path:\n      '${b.path}',${extra ? `\n${extra}` : ''}\n  },`
  })
  .join('\n')}
}
`
const brandExisting = (() => {
  try {
    return readFileSync(BRAND_OUT, 'utf8')
  } catch {
    return ''
  }
})()

if (process.argv.includes('--check')) {
  if (existing !== file || brandExisting !== brandFile) {
    console.error('generated glyph tables are stale — run: node scripts/gen-shape-glyphs.mjs')
    process.exit(1)
  }
  console.log(`glyph tables up to date (${ids.length} shapes, ${brandIds.length} brands)`)
} else {
  writeFileSync(OUT, file, 'utf8')
  writeFileSync(BRAND_OUT, brandFile, 'utf8')
  console.log(
    `wrote shape-glyphs.ts (${ids.length} shapes, ${file.length} bytes) + ` +
      `brand-badges.ts (${brandIds.length} brands, ${brandFile.length} bytes)`,
  )
}
