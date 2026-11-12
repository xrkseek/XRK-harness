/** Locale preference stored in the Host user-settings document. */

import z from '@xrkseek/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Locale identifiers shipped by the browser client. */
export const LOCALE_IDS = ['zh', 'en', 'ja'] as const

/** Preference ids: concrete languages plus follow-OS/browser. */
export const LOCALE_PREFERENCE_IDS = ['system', ...LOCALE_IDS] as const

/** Shipped locale identifier. */
export type LocaleId = typeof LOCALE_IDS[number]

/** Durable preference including `system` (follow browser / OS). */
export type LocalePreferenceId = typeof LOCALE_PREFERENCE_IDS[number]

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /** Explicit locale selection; `system` / absence delegates to the browser. */
  preference?: LocalePreferenceId
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsSchema: z<LocaleSettings> = z.object({
  [LOCALE_PREFERENCE_FIELD]: z.union([...LOCALE_PREFERENCE_IDS]).required(false),
})
