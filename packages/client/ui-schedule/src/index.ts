/**
 * Scheduled-task directory plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the Host cordis.yml / Loader; the browser
 * half ships via exports["./client"] and is discovered through the package.json
 * xrk.client declaration.
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}