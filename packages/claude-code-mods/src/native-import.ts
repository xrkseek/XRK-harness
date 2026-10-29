/**
 * Native dynamic `import()`, spliced through `new Function` so no bundler or
 * test transform rewrites it into its own module graph.
 *
 * Two reasons this cannot be a plain `import(url)`:
 *
 * 1. **Third-party code.** A Claude Code plugin's hook module lives outside our
 *    build graph and is not ours to transform; it has to be evaluated by Node's
 *    own ESM loader.
 * 2. **Percent-encoded paths.** vite-node (vitest) intercepts a literal
 *    `import(fileUrl)` and resolves the *encoded* URL as a filesystem path, so a
 *    plugin under a non-ASCII directory (a Windows profile with CJK characters,
 *    which is our development environment) fails with "Does the file exist?".
 *
 * Node's ESM loader accepts a `?query` suffix and treats it as a distinct module
 * instance, which is how a host re-loads an edited hook module without dropping
 * the rest of the process.
 *
 * Constraint: `new Function` needs an unrestricted context, so this is for the
 * Host/Node side only. A CSP-locked renderer must inject its own importer.
 */

/**
 * Load a module specifier or `file://` URL with Node's loader.
 *
 * A runtime-computed specifier cannot appear in a static `import()` — the parser
 * resolves that form, so the module graph has to be reached through the
 * `Function` constructor. This is the documented cost of the Host-side path and
 * the reason a CSP-locked renderer must inject its own importer instead.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
export const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;
