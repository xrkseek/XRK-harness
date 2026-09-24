/**
 * Workspace workbench plugin, node half. Pure UI plugin: empty apply so the
 * package appears on the Host loader roster; the browser half ships via
 * exports["./client"] (`xrk.client` in package.json).
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
