/**
 * Session-header toggle for the first-party floating workbench.
 * Renders nothing when a community sidebar claimed `ctx.betterSidebar`.
 */
import { useState } from 'react'
import { IconBrowseOutline16 } from '@xrkseek/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import type { WorkbenchController } from './controller.ts'
import css from './WorkbenchToggle.module.css'

/** Injected controller + live yield check. */
export interface WorkbenchToggleInjected {
  workbench: WorkbenchController
  /** True when community workbench owns the surface. */
  yielded: () => boolean
}

export type WorkbenchToggleProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<WorkbenchToggleInjected>
  & PropsLocale<'workbench'>

/**
 * Header button that opens/closes {@link WorkbenchController}.
 * @param props - slot runtime + inject + locale.
 */
export function WorkbenchToggle({ workbench, yielded, t }: WorkbenchToggleProps) {
  const [, bump] = useState(0)
  if (yielded()) return null
  const open = workbench.open

  return (
    <button
      type="button"
      className={css.trigger}
      aria-pressed={open}
      aria-label={open ? t('toggleClose') : t('toggleOpen')}
      data-workbench-toggle
      onClick={() => {
        if (workbench.open) workbench.hide()
        else workbench.show()
        bump(n => n + 1)
      }}
    >
      <IconBrowseOutline16 size={16} />
      <span className={css.label}>{t('toggle')}</span>
    </button>
  )
}
