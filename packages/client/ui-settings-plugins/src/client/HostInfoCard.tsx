/**
 * Read-only Host runtime card (Face `host`) on Plugins → Advanced.
 *
 * A user opens this to answer "which Host am I talking to": the address, the
 * workspace it serves, the Host plugins it applied. Nothing here is a
 * preference, so the card has no footer.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { InfoRows } from './InfoRows.tsx'
import { PluginCard } from './PluginCard.tsx'
import { READ_ONLY_SHELL } from './info-card-model.ts'
import type { HostInfoCardFace } from './host-info-card-controller.ts'
import type {} from './advanced-slot-contract.ts'

/** Props the renderer binds for the Host runtime card. */
export type HostInfoCardProps =
  PropsRuntime<'settings.plugin.advanced.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<HostInfoCardFace>

/**
 * Render the read-only Host runtime card.
 * @param props - locale copy and the Host rows snapshot.
 * @returns the card, or nothing while the Host serves no `host` namespace.
 */
export function HostInfoCard(props: HostInfoCardProps) {
  const { t } = props
  const state = props.useHostInfoCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="hostTitle"
      descriptionKey="hostDescription"
      state={{ ...READ_ONLY_SHELL, available: state.available }}
      readOnly
    >
      <InfoRows t={t} rows={state.rows} />
    </PluginCard>
  )
}
