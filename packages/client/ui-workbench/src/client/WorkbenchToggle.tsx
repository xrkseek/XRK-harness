/**
 * Session-header toggle for the first-party floating workbench.
 * Always visible next to the session title. When community
 * `xrkh-better-sidebar` claimed `ctx.betterSidebar`, the builtin panel yields
 * and this button opens the community side card instead.
 */
import { useState, useSyncExternalStore } from 'react'
import { IconBrowseOutline16 } from '@xrkseek/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import type { WorkbenchController } from './controller.ts'
import css from './WorkbenchToggle.module.css'

/** Community side-card face used when the builtin panel has yielded. */
export interface CommunityWorkbenchOpen {
  /** Ensure the community panel is open (opens a default tab if needed). */
  open: () => void
  /** Live panel-open bit when the community store exposes it. */
  isOpen?: () => boolean
  /** Subscribe to community store changes (for pressed-state). */
  subscribe?: (listener: () => void) => () => void
}

/** Injected controller + live yield check. */
export interface WorkbenchToggleInjected {
  workbench: WorkbenchController
  /** True when community workbench owns the floating panel. */
  yielded: () => boolean
  /** Open the community side card when {@link yielded} is true. */
  openCommunity?: CommunityWorkbenchOpen
}

export type WorkbenchToggleProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<WorkbenchToggleInjected>
  & PropsLocale<'workbench'>

const noopSubscribe = (_listener: () => void): (() => void) => () => {}

/**
 * Header button that opens/closes {@link WorkbenchController}, or the
 * community side card when that surface has claimed the workbench.
 * @param props - slot runtime + inject + locale.
 */
export function WorkbenchToggle({
  workbench, yielded, openCommunity, t,
}: WorkbenchToggleProps) {
  const [, bump] = useState(0)
  const community = yielded()
  const communityOpen = useSyncExternalStore(
    openCommunity?.subscribe ?? noopSubscribe,
    () => openCommunity?.isOpen?.() ?? false,
    () => false,
  )
  const open = community ? communityOpen : workbench.open

  return (
    <button
      type="button"
      className={css.trigger}
      aria-pressed={open}
      aria-label={open ? t('toggleClose') : t('toggleOpen')}
      data-workbench-toggle
      data-workbench-yielded={community ? 'true' : undefined}
      onClick={() => {
        if (community) {
          openCommunity?.open()
        } else if (workbench.open) {
          workbench.hide()
        } else {
          workbench.show()
        }
        bump(n => n + 1)
      }}
    >
      <IconBrowseOutline16 size={16} />
      <span className={css.label}>{t('toggle')}</span>
    </button>
  )
}
