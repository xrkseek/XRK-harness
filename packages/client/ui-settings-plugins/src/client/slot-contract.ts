/**
 * Plugin configuration slots this package declares.
 *
 * - `settings.plugin.item` — Settings → Plugins → Configurable cards, keyed by
 *   the settings namespace (or community self-key, e.g. `modlens`).
 * - `plugins.bundle.config` — DSH-shaped keyed seat community clients also
 *   inject into (`@liustack/modlens` dual-registers here). Declared so
 *   `slots.inject` resolves; XRK surfaces the Settings card via
 *   `settings.plugin.item` rather than a separate Plugins-manager page.
 *
 * TYPE HOME RATIONALE: the tab declares these slots at runtime; community
 * packages register through `ctx.slots` without importing this package.
 */
declare module '@xrkseek/client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section (see module JSDoc). */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
    /**
     * Bundle-owned configuration keyed by npm package name (DSH Plugins page
     * contract). Community clients inject here; XRK declares the seat so inject
     * does not wait forever.
     */
    'plugins.bundle.config': { kind: 'keyed'; scope: 'root'; owner: PluginBundleConfigOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/** Owner share for a DSH-shaped bundle config entry (`view: 'page'` on detail). */
export interface PluginBundleConfigOwnerProps {
  /** `page` = full form; `summary` = one-liner (XRK Configurable tab uses `page`). */
  readonly view: 'summary' | 'page'
}
