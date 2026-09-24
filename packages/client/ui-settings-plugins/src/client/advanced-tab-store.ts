/**
 * The advanced-plugins tab's card list — same controller as configurable,
 * over `settings.plugin.advanced.item`.
 */

import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  ConfigurablePluginsTabController,
  type ConfigurablePluginsTabFace,
  type ConfigurablePluginsTabState,
} from './tab-store.ts'

export {
  ConfigurablePluginsTabController as AdvancedPluginsTabController,
}
export type { ConfigurablePluginsTabState as AdvancedPluginsTabState }

/** The registration-side face the advanced tab's slot entry injects. */
export interface AdvancedPluginsTabFace {
  hooks: {
    /** Bound by the renderer as useAdvancedPlugins. */
    advancedPlugins: SnapshotStore<ConfigurablePluginsTabState>
  }
}

/** Remap configurable inject → advanced hook name for the Advanced tab. */
export function asAdvancedPluginsTabFace(
  face: ConfigurablePluginsTabFace,
): AdvancedPluginsTabFace {
  return {
    hooks: { advancedPlugins: face.hooks.configurablePlugins },
  }
}
