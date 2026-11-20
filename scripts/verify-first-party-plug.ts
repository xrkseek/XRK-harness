/**
 * First-party extensions author against XRK Plug only.
 *
 * Scans extensions/* (except the inbound community adapter) for author-path
 * markers that belong on community packages, not first-party / gold samples.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const EXTENSIONS = resolve(ROOT, 'extensions')

/** Built-in inbound adapter — may mention community markers. */
const ALLOWED_DIRS = new Set(['dsh-compat'])

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'vendor',
  // Published / generated halves — author against src/; lib/ mirrors build output
  // and may still carry third-party comment provenance until the next pack.
  'lib',
])

const SCAN_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.md',
  '.json',
])

/** Patterns that first-party / gold-sample trees must not ship. */
const FORBIDDEN: readonly { readonly id: string; readonly re: RegExp }[] = [
  { id: 'dsh.client marker', re: /\bdsh\.client\b/ },
  { id: '@deepseek-ai import', re: /@deepseek-ai\// },
  { id: 'legacy dsh-plugin-* id', re: /\bdsh-plugin-[a-z0-9-]+/i },
  { id: 'third-party fork URL', re: /HuanLinOTO|huanlin\//i },
]

type Hit = { readonly file: string; readonly line: number; readonly id: string; readonly excerpt: string }

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out)
      continue
    }
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot) : ''
    if (!SCAN_EXT.has(ext)) continue
    out.push(full)
  }
}

function scanFile(file: string): Hit[] {
  const text = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  const hits: Hit[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    for (const rule of FORBIDDEN) {
      if (!rule.re.test(line)) continue
      hits.push({
        file: rel,
        line: i + 1,
        id: rule.id,
        excerpt: line.trim().slice(0, 160),
      })
    }
  }
  return hits
}

function main(): void {
  const tops = readdirSync(EXTENSIONS).filter((name) => {
    if (ALLOWED_DIRS.has(name)) return false
    try {
      return statSync(join(EXTENSIONS, name)).isDirectory()
    } catch {
      return false
    }
  })

  if (tops.length < 3) {
    console.error(
      `verify-first-party-plug: expected ≥3 first-party extension dirs, got ${tops.length}`,
    )
    process.exit(1)
  }

  const files: string[] = []
  for (const top of tops) walk(join(EXTENSIONS, top), files)

  const hits = files.flatMap(scanFile)
  if (hits.length === 0) {
    console.log(
      `verify-first-party-plug: ok (${tops.length} extensions, ${files.length} files)`,
    )
    return
  }

  console.error('verify-first-party-plug: first-party trees must not ship community author markers:\n')
  for (const hit of hits.slice(0, 40)) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.id}]  ${hit.excerpt}`)
  }
  if (hits.length > 40) console.error(`  … +${hits.length - 40} more`)
  process.exit(1)
}

main()
