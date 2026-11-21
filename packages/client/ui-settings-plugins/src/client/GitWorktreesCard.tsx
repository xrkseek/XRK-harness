/** Optional main-session git worktree bundle on Plugins → configuration. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { GitWorktreesCardFace } from './git-worktrees-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

export type GitWorktreesCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<GitWorktreesCardFace>

/** Header switch only — Host remounts create_worktree when enabled. */
export function GitWorktreesCard(props: GitWorktreesCardProps) {
  const { t } = props
  const state = props.useGitWorktreesCard((snapshot) => snapshot)
  // Always mount: product optional lives on Plugins → configuration (not the
  // inventory list). Hiding on !available made the card vanish between MCP and
  // Web Search when inventory refresh lagged or missed the row.
  return (
    <PluginCard
      t={t}
      titleKey="gitWorktreesTitle"
      descriptionKey="gitWorktreesDescription"
      state={{
        available: true,
        writable: state.available && !state.busy,
        dirty: false,
        invalid: false,
        saving: state.busy,
        failed: state.failed || !state.available,
      }}
      masterSwitch={booleanMasterSwitch(state.enabled, (value) => {
        props.setEnabled(value)
      })}
      switchOnly
    >
      <p className={css.note} role="note">{t('gitWorktreesLiveHint')}</p>
    </PluginCard>
  )
}
