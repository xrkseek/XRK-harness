/**
 * Sidebar utility Plugins entry (DSH panellist seat: under New Session, above Workspace).
 * Opens Settings → Plugins without burying the entry only inside the gear menu.
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconPersonalizationOutline16, Tooltip } from '@xrkseek/client-ui-primitives'
import css from './PluginsHomeButton.module.css'

/** Injected open face from `ctx.settingsNav` (purity-safe). */
export interface PluginsHomeButtonInjected {
  openPlugins: () => void
}

export type PluginsHomeButtonProps =
  PropsRuntime<'sidebar.utility'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<PluginsHomeButtonInjected>

/** Render the sidebar Plugins row (wide label / rail icon). */
export function PluginsHomeButton({
  wide,
  t,
  openPlugins,
}: PluginsHomeButtonProps): ReactNode {
  const label = t('nav')
  return (
    <Tooltip label={label} disabled={wide}>
      <button
        type="button"
        className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-label={label}
        onClick={() => { openPlugins() }}
      >
        <span className={css.icon} aria-hidden>
          <IconPersonalizationOutline16 size={wide ? 16 : 18} />
        </span>
        {wide ? <span className={css.label}>{label}</span> : null}
      </button>
    </Tooltip>
  )
}
