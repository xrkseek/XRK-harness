/**
 * Settings → General: one switch.
 * On → Co-authored-by: xrkseek; off → no guidance (feature absent).
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { GitAttributionCardFace } from './git-attribution-card-controller.ts'
import type {} from './slot-contract.ts'

export type GitAttributionCardProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<GitAttributionCardFace>

/** Header switch only — no fields, no identity editor. */
export function GitAttributionCard(props: GitAttributionCardProps) {
  const { t } = props
  const state = props.useGitAttributionCard(snapshot => snapshot)
  if (!state.available) return null
  const enabled = state.enabled.text !== 'false'
  return (
    <PluginCard
      t={t}
      titleKey="gitAttributionTitle"
      descriptionKey="gitAttributionDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(enabled, (value) => {
        props.commit('enabled', value)
      })}
      switchOnly
    >
      {null}
    </PluginCard>
  )
}
