/**
 * Native directory-picker surface, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * xrk.client declaration. The OS chooser it drives lives in
 * `@xrkseek/xrk-host-directory-picker-native`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
