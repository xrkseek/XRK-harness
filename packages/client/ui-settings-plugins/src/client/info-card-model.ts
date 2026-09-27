/**
 * Shared shape of the read-only Host information cards.
 *
 * Both cards render the same thing — lines naming a fact and showing its
 * value — over sections the user cannot edit. The value is either text the
 * Host published (`host`, paths, counts) or one of a closed set the copy
 * owns (`bridge` / `sidecar`, whether the Web bundle is Host-served), so a
 * row carries whichever of the two it needs.
 */

import type { CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'

/** Placeholder for a fact this Host does not publish. */
export const ABSENT = '—'

/**
 * The card chrome of a read-only information card: never writable, and
 * therefore never dirty, invalid, saving, or failed. Callers spread it and
 * supply `available` from their own scope snapshot.
 */
export const READ_ONLY_SHELL: Omit<CardShell, 'available'> = {
  writable: false,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

/** One read-only line on an information card. */
export interface InfoRow {
  /** Locale key naming the fact. */
  readonly label: PluginsSettingsLocaleKey
  /** Literal value, shown unless {@link InfoRow.valueKey} is set. */
  readonly value: string
  /** Locale key for a value the copy owns rather than the Host publishing. */
  readonly valueKey?: PluginsSettingsLocaleKey
}

/** Join published names for display, or the absent placeholder when empty. */
export function joinList(values: readonly string[] | undefined): string {
  return values !== undefined && values.length > 0 ? values.join(' · ') : ABSENT
}

/** Narrow an untrusted section to a plain object, or undefined for anything else. */
export function asSection<T>(section: unknown): T | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  return section as T
}
