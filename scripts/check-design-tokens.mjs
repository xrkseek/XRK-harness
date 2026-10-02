#!/usr/bin/env node
// Design-system contract self-check.
//
// Fails when a `--dsw-*` token is *consumed* without a fallback but never
// defined in the token sheets — CSS silently drops those declarations, so a
// `color`/`border-color`/`outline` falls back to the inherited value and the
// bug ships invisible. Also checks WCAG AA contrast for the text tokens that
// carry most copy, and the focus-ring contract (a sheet that kills the outline
// must replace it — `:focus`, `:focus-visible` or a `:focus-within` wrapper).
//
// The token regex covers both the theme sheet prefix `--dsw-*` and the
// scheme-invariant `--ds-*` (motion budget, elevation scale) added in
// interaction.css. Checking only `--dsw-*` would have left the newer tokens
// unverified — a green light that means nothing.
//
// Run: node scripts/check-design-tokens.mjs
// Exit code 1 on any violation.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'packages/client')
const THEME_STYLES = join(CLIENT, 'ui-theme/src/styles')
// Build output and generated bundles restate the same rules; auditing them
// would only re-report the sources.
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', '.codegraph', 'coverage', '.tmp-audit'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(CLIENT)

// ---------------------------------------------------------------- token sheet
/** Parse every `--dsw-x: value` inside each top-level `body {...}` / `:root {...}` block. */
function parseSheet(path) {
  const css = readFileSync(path, 'utf8')
  const blocks = []
  const re = /^(body(\[[^\]]*\])?|:root)\s*\{/gm
  let m
  while ((m = re.exec(css))) {
    const start = css.indexOf('{', m.index)
    let depth = 0
    let end = start
    for (let j = start; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) { end = j; break }
    }
    const vars = {}
    for (const mm of css.slice(start, end).matchAll(/(--dsw-[a-z0-9-]+|--ds-[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[mm[1]] = mm[2].trim()
    blocks.push({ dark: (m[1] ?? '').includes('dark'), vars })
    re.lastIndex = end
  }
  return blocks
}

const sheetFiles = readdirSync(THEME_STYLES).filter((f) => f.endsWith('.css')).map((f) => join(THEME_STYLES, f))
const blocks = sheetFiles.flatMap(parseSheet)
const defined = new Set(blocks.flatMap((b) => Object.keys(b.vars)))
const palettes = {
  light: Object.assign({}, ...blocks.filter((b) => !b.dark).map((b) => b.vars)),
  dark: Object.assign({}, ...blocks.filter((b) => b.dark).map((b) => b.vars)),
}

// ---------------------------------------------------------- 1. dead references
const dead = new Map()
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--dsw-[a-z0-9-]+|--ds-[a-z0-9-]+)\s*(,?)\s*([^)]*)\)/g)) {
      const [, token, comma, rest] = m
      if (defined.has(token)) continue
      if (comma === ',' && rest.trim()) continue // has a fallback: degrades visibly, not silently
      if (!dead.has(token)) dead.set(token, [])
      dead.get(token).push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`)
    }
  })
}

// ------------------------------------------------------------------ 2. contrast
const lum = (c) => {
  const [r, g, b] = c.match(/[\d.]+/g).map(Number)
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const resolve = (mode, token) => {
  let v = palettes[mode][token]
  for (let i = 0; i < 8 && v; i++) {
    const m = v.match(/^var\((--dsw-[a-z0-9-]+)\)$/)
    if (!m) break
    v = palettes[mode][m[1]]
  }
  return v && /^(rgb|rgba)/.test(v) ? v : null
}

/** Text that must clear WCAG AA 4.5:1 on the surface it is designed to sit on. */
const CONTRAST_CASES = [
  ['light', '--dsw-alias-bg-base'],
  ['dark', '--dsw-alias-bg-base'],
  ['light', '--dsw-alias-bg-layer-3'],
  ['dark', '--dsw-alias-bg-layer-3'],
  ['light', '--dsw-specific-bubble'],
  ['dark', '--dsw-specific-bubble'],
]
const TEXT_TOKENS = [
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
]
const lowContrast = []
for (const [mode, surface] of CONTRAST_CASES) {
  const bg = resolve(mode, surface)
  if (!bg) continue
  for (const token of TEXT_TOKENS) {
    const fg = resolve(mode, token)
    if (!fg) continue
    const r = ratio(fg, bg)
    if (r < 4.5) lowContrast.push({ mode, surface, bg, token, fg, r })
  }
}

// ------------------------------------------------------------ 3. focus contrast
// A focus ring is a non-text indicator, so the bar is 3:1 — but measuring it
// against only one side is the classic miss: an indicator can clear 3:1
// against the component's own fill and vanish against the page behind it.
// Each case names the indicator plus the surfaces it actually touches.
const FOCUS_CASES = [
  ['InputBar .card border', '--dsw-alias-brand-primary', ['--dsw-specific-input-major', '--dsw-alias-bg-base']],
  ['dialog field ring', '--dsw-alias-brand-primary', ['--dsw-alias-bg-overlay', '--dsw-alias-bg-base']],
  ['Rows .renameInput ring', '--dsw-alias-brand-primary', ['--dsw-alias-button-elevated-fill', '--dsw-alias-bg-layer-1']],
  ['PopupSelectView .search ring', '--dsw-alias-brand-primary', ['--dsw-specific-menu', '--dsw-alias-bg-base']],
  ['WorkspaceBrowser .searchInput ring', '--dsw-alias-brand-primary', ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-base']],
]
// `--explain` prints every measured pair instead of only the failures: a check
// that reports nothing and a check that measured nothing look identical from the
// outside, and that ambiguity is exactly how a green light stops meaning one.
const EXPLAIN = process.argv.includes('--explain')
const focusMeasurements = []
const lowFocusContrast = []
const unresolvedFocus = []
for (const [label, indicator, surfaces] of FOCUS_CASES) {
  for (const mode of ['light', 'dark']) {
    const fg = resolve(mode, indicator)
    if (!fg) { unresolvedFocus.push(`${label} [${mode}] indicator ${indicator}`); continue }
    for (const surface of surfaces) {
      const bg = resolve(mode, surface)
      if (!bg) { unresolvedFocus.push(`${label} [${mode}] surface ${surface}`); continue }
      const r = ratio(fg, bg)
      focusMeasurements.push(`${r.toFixed(2).padStart(6)}:1  ${r >= 3 ? 'pass' : 'FAIL'}  [${mode.padEnd(5)}] ${label} on ${surface}`)
      if (r < 3) lowFocusContrast.push({ label, mode, indicator, surface, r })
    }
  }
}

// ------------------------------------------------- 4. sheet structural integrity
// A hand-edited token sheet can silently ship a missing brace or a var() cycle;
// both invalidate every declaration after the damage. Cheap to assert.
const structural = []
for (const file of sheetFiles) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  let minDepth = 0
  for (const ch of css) {
    if (ch === '{') depth++
    else if (ch === '}' && --depth < minDepth) minDepth = depth
  }
  if (depth !== 0 || minDepth !== 0) structural.push(`${relative(ROOT, file)}: unbalanced braces (final=${depth}, min=${minDepth})`)

  // Walk each declaration's var() chain across all sheets; a cycle or a tail
  // naming a token nothing defines leaves the consumer with an invalid value.
  const all = Object.assign({}, ...blocks.map((b) => b.vars))
  for (const [token, raw] of Object.entries(all)) {
    const seen = new Set([token])
    let cur = raw
    while (cur.startsWith('var(')) {
      const next = cur.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/)
      if (!next) break // var() with extra args or trailing content: not a bare alias
      if (seen.has(next[1])) { structural.push(`${relative(ROOT, file)}: cycle ${token} -> ${next[1]}`); break }
      seen.add(next[1])
      if (next[1] in all) cur = all[next[1]]
      else if (next[1].startsWith('--dsw-') || next[1].startsWith('--ds-')) { structural.push(`${relative(ROOT, file)}: ${token} -> undefined ${next[1]}`); break }
      else break // upstream token (--ds-*, --dsw-font-family) lives outside this sheet
    }
  }
}

// ------------------------------------------------------ 4. focus-ring contract
// `outline: none` with nothing in the same sheet to replace it leaves keyboard
// users with no cue at all — the most common accessibility defect in a CSS
// codebase this size. `:focus-within` on a wrapper counts as a replacement:
// when an input's visual boundary is the wrapper, that is the *correct* ring
// rather than a missing one. A sheet may carry a `focus-exempt` note when the
// declaration sits on something genuinely not focusable.
const focusKilled = []
for (const file of files) {
  if (!file.endsWith('.css')) continue
  const css = readFileSync(file, 'utf8')
  if (/:focus\b|:focus-visible|:focus-within/.test(css)) continue
  if (/focus-exempt/.test(css)) continue
  const lines = css.split(/\r?\n/)
  lines.forEach((line, i) => {
    // The declaration may share a line with its selector (`button { outline:
    // none; }`), so anchor on the statement boundary rather than line start —
    // an anchor that assumes one-declaration-per-line makes the guard a no-op
    // for any minified or hand-compacted sheet. `outline-width` / `outline-color`
    // do not match because `-` is not a statement boundary here.
    if (!/(^|[;{])\s*outline\s*:\s*(none|0)\s*[;}]/.test(line)) return
    let sel = '(unknown)'
    for (let j = i - 1; j >= 0 && j > i - 30; j--) {
      if (/\{/.test(lines[j]) && !/^\s*@/.test(lines[j])) { sel = lines[j].replace(/\{.*/, '').trim(); break }
    }
    focusKilled.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  [${sel}]`)
  })
}

// ------------------------------------------------------------------ 5. report
let failed = false
const log = console.log

if (dead.size) {
  failed = true
  log(`FAIL  ${dead.size} token(s) consumed without a fallback but never defined — those declarations are dropped by the CSS parser:\n`)
  for (const [token, sites] of [...dead].sort((a, b) => b[1].length - a[1].length)) {
    log(`  ${token}  (${sites.length} site${sites.length === 1 ? '' : 's'})`)
    for (const s of sites.slice(0, 6)) log(`      ${s}`)
    if (sites.length > 6) log(`      ... +${sites.length - 6} more`)
  }
  log('')
}

if (lowContrast.length) {
  failed = true
  log(`FAIL  ${lowContrast.length} text/surface pair(s) below WCAG AA 4.5:1:\n`)
  for (const c of lowContrast) {
    log(`  [${c.mode}] ${c.token.replace('--dsw-alias-', '')} on ${c.surface.replace('--dsw-', '')}  ${c.r.toFixed(2)}:1`)
    log(`        fg ${c.fg}  vs  bg ${c.bg}`)
  }
  log('')
}

if (EXPLAIN) {
  log(`focus-indicator contrast (bar 3:1), ${focusMeasurements.length} measured pair(s):\n`)
  for (const line of focusMeasurements) log(`  ${line}`)
  log('')
}

if (lowFocusContrast.length) {
  failed = true
  log(`FAIL  ${lowFocusContrast.length} focus-indicator/surface pair(s) below the 3:1 non-text bar — keyboard users may not see the ring:\n`)
  for (const c of lowFocusContrast) {
    log(`  ${c.r.toFixed(2).padStart(5)}:1  ${c.label}  ${c.indicator} on ${c.surface}  [${c.mode}]`)
  }
  log('')
}

if (unresolvedFocus.length) {
  // Not a failure: an unresolvable token cannot be judged. Surface it so a
  // renamed or re-tinted focus colour cannot quietly escape the check.
  log(`note  ${unresolvedFocus.length} focus-contrast pair(s) not machine-checkable (token did not resolve to a literal colour):\n`)
  for (const u of unresolvedFocus) log(`  ${u}`)
  log('')
}

if (structural.length) {
  failed = true
  log(`FAIL  ${structural.length} structural problem(s) in the token sheets:\n`)
  for (const s of [...new Set(structural)]) log(`  ${s}`)
  log('')
}

if (focusKilled.length) {
  failed = true
  log(`FAIL  ${focusKilled.length} outline suppression(s) with no focus replacement in the same sheet — keyboard users get no focus cue:\n`)
  for (const s of focusKilled) log(`  ${s}`)
  log('      (a `:focus-within` wrapper counts; add a `focus-exempt` note if the element is not focusable)\n')
}

if (failed) {
  log('design-token contract: FAILED')
  process.exit(1)
}
log(`design-token contract: OK (${defined.size} tokens, ${lowContrast.length === 0 ? 'all text pairs >= 4.5:1' : ''})`)
