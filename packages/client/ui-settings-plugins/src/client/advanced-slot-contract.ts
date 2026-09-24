/**
 * The `settings.plugin.advanced.item` slot — cards on Plugins → Advanced,
 * keyed by the settings namespace each card edits (same pairing rule as
 * `settings.plugin.item`).
 */
declare module '@xrkseek/client-ui-slots' {
  interface SlotMap {
    /** One advanced plugin card (see module JSDoc). */
    'settings.plugin.advanced.item': {
      kind: 'keyed'
      scope: 'root'
      owner: SettingsPluginAdvancedItemOwnerProps
    }
  }
}

/** Owner share of an advanced plugin card (the tab supplies nothing). */
export interface SettingsPluginAdvancedItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}
