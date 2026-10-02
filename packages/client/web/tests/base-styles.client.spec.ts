/**
 * Shell base sheet contract, asserted against the CSS text on disk: base.css is
 * where the ui-theme token sheets enter the bundle, every sheet it names exists,
 * and scrollbar.css follows design-platform.css because it reads that sheet's
 * tokens.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// import.meta.dirname: under this lane `import.meta.url` is not always file:.
const HERE = import.meta.dirname
const THEME_PACKAGE = '@xrkseek/client-ui-theme'
const baseCss = readFileSync(path.join(HERE, '../src/base.css'), 'utf8')
const themeManifest = JSON.parse(
  readFileSync(path.join(HERE, '../../ui-theme/package.json'), 'utf8'),
) as { exports: Record<string, string>; files: string[] }

/**
 * Import specifiers of the sheet, in source order. Quote style and surrounding
 * whitespace are normalized away.
 * @param css - stylesheet text.
 * @returns each `@import` target in the order the sheet lists it.
 */
function importOrder(css: string): string[] {
  // The destructuring default only satisfies noUncheckedIndexedAccess; the
  // group is unconditional in the pattern.
  return [...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, specifier = '']) => specifier)
}

/**
 * Resolve a `<package>/styles/<file>` specifier to its source path for a
 * clean-tree test. The package build copies these sheets to their public
 * `lib/styles` export.
 * @param specifier - import specifier from base.css.
 * @returns absolute path of the file the specifier names.
 */
function resolveThemeSheet(specifier: string): string {
  const name = specifier.slice(`${THEME_PACKAGE}/styles/`.length)
  return path.join(HERE, `../../ui-theme/src/styles/${name}`)
}

const imports = importOrder(baseCss)

describe('web shell base.css', () => {
  it('publishes theme sheets from the package styles plane', () => {
    expect(themeManifest.exports['./styles/*']).toBe('./src/styles/*')
  })

  it('imports every sheet from the theme package and each one exists', () => {
    expect(imports.length).toBeGreaterThan(0)
    for (const specifier of imports) {
      expect(specifier.startsWith(`${THEME_PACKAGE}/styles/`), specifier).toBe(true)
      expect(existsSync(resolveThemeSheet(specifier)), specifier).toBe(true)
    }
  })

  it('imports the scrollbar sheet after the token sheet it reads', () => {
    // Both sheets bind on `body`, so with scrollbar.css first the alias tokens
    // would still resolve; the order encodes the dependency direction so a
    // later specificity or selector change cannot silently invert it.
    const platform = imports.indexOf(`${THEME_PACKAGE}/styles/design-platform.css`)
    const scrollbar = imports.indexOf(`${THEME_PACKAGE}/styles/scrollbar.css`)
    expect(platform).toBeGreaterThanOrEqual(0)
    expect(scrollbar).toBeGreaterThan(platform)
  })
})
