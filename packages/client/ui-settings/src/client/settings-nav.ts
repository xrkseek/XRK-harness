/**
 * Cross-plugin entry into the Settings shell (DSH openSection pattern).
 * ui-settings-general binds the live opener via {@link SettingsNavBinder};
 * Plugins home / onboarding call {@link SettingsNavBinder.openSection}
 * through the cordis service (client bundle purity forbids value imports).
 */

import { Service } from '@xrkseek/cordis'
import type { Context } from '@xrkseek/cordis'

type OpenSection = (id: string) => void

let opener: OpenSection | null = null

/** Bind the Settings shell's openSection for the lifetime of the mounted root. */
export function bindSettingsOpenSection(next: OpenSection): () => void {
  opener = next
  return () => {
    if (opener === next) opener = null
  }
}

/**
 * Open Settings to a nav section id (`plugins`, `models`, `general`, …).
 * No-op when the shell is not mounted.
 */
export function openSettingsSection(id: string): void {
  const trimmed = id.trim()
  if (!trimmed) return
  opener?.(trimmed)
}

declare module '@xrkseek/cordis' {
  interface Context {
    settingsNav: SettingsNavBinder
  }
}

/**
 * Cordis face for Settings openSection — the purity-safe path across plugins.
 */
export class SettingsNavBinder extends Service {
  /**
   * @param ctx - the providing plugin's context.
   */
  constructor(ctx: Context) {
    super(ctx, 'settingsNav')
  }

  /** Bind the shell opener; returns an unbind for effect cleanup. */
  bindOpenSection(next: OpenSection): () => void {
    return bindSettingsOpenSection(next)
  }

  /** Open Settings to a section id (no-op if unbound). */
  openSection(id: string): void {
    openSettingsSection(id)
  }
}
