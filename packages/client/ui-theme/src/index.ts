/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@xrkseek/cordis'
import type {} from '@xrkseek/xrk-host-webserver'
import { settingsNamespace } from '@xrkseek/xrk-settings'
import { injectBootTheme } from './boot-theme.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_MAX, FONT_SIZE_MIN, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the registered theme section or the schema defaults without a settings provider. */
function readSection(ctx: Context): { preference: ThemePreference; fontSize: number } {
  const fallback = { preference: DEFAULT_PREFERENCE, fontSize: DEFAULT_FONT_SIZE }
  const settings = ctx.get('settings')
  if (settings === undefined) return fallback
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return fallback
  const fontSize = typeof section.fontSize === 'number'
    && Number.isInteger(section.fontSize)
    && section.fontSize >= FONT_SIZE_MIN
    && section.fontSize <= FONT_SIZE_MAX
    ? section.fontSize
    : DEFAULT_FONT_SIZE
  return {
    preference: section.preference ?? DEFAULT_PREFERENCE,
    fontSize,
  }
}

/**
 * Register the durable theme section and initial-theme index transform when
 * their optional Host services are composed.
 * @param ctx - Host context that may acquire settings and HTTP services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex((html) => {
        const section = readSection(ctx)
        return injectBootTheme(html, section.preference, section.fontSize)
      }),
      'client-ui-theme: initial theme bootstrap',
    )
  })
}
