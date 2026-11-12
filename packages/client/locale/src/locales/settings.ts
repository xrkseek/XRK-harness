/** `settings.locale` namespace dictionaries (the Language row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'language.title': '语言',
  'language.system': '跟随系统',
} satisfies Record<string, string>

/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'language.title': 'Language',
  'language.system': 'Follow system',
} satisfies Record<SettingsLocaleKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'language.title': '言語',
  'language.system': 'システムに合わせる',
} satisfies Record<SettingsLocaleKey, string>
