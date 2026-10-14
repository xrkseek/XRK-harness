/**
 * Shared master-switch wiring for Host plugin cards.
 * Aria label comes from the card title (PluginCard default) — no per-switch locales.
 */

import type { PluginCardMasterSwitch } from './PluginCard.tsx'

/** Stage a Face `enabled: boolean` field as a header switch. */
export function booleanMasterSwitch(
  checked: boolean,
  edit: (value: 'true' | 'false') => void,
): PluginCardMasterSwitch {
  return {
    checked,
    onChange: (next) => { edit(next ? 'true' : 'false') },
  }
}

/**
 * Stage a Face `mode` field (`off` | …) as a header switch.
 * Turning on restores `enableMode` when currently off.
 */
export function modeMasterSwitch(
  mode: string,
  edit: (mode: string) => void,
  enableMode: string,
): PluginCardMasterSwitch {
  return {
    checked: mode !== 'off',
    onChange: (next) => {
      edit(next ? (mode === 'off' ? enableMode : mode) : 'off')
    },
  }
}
