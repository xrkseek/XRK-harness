/**
 * Read-only channel card (Face `process-channels`) on Plugins → Advanced.
 *
 * It answers "what is the Host wired to talk to": the channel plugins it
 * applied at spawn, the IM vendor stubs it discovered, and the IM gateway mode
 * it resolved. Wiring is fixed at spawn, so there is nothing to write.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { InfoRows } from './InfoRows.tsx'
import { PluginCard } from './PluginCard.tsx'
import { READ_ONLY_SHELL } from './info-card-model.ts'
import type { ProcessChannelsCardFace } from './process-channels-card-controller.ts'
import type {} from './advanced-slot-contract.ts'

/** Props the renderer binds for the channel card. */
export type ProcessChannelsCardProps =
  PropsRuntime<'settings.plugin.advanced.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ProcessChannelsCardFace>

/**
 * Render the read-only channel card.
 * @param props - locale copy and the channel rows snapshot.
 * @returns the card, or nothing while the Host serves no `process-channels` namespace.
 */
export function ProcessChannelsCard(props: ProcessChannelsCardProps) {
  const { t } = props
  const state = props.useProcessChannelsCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="channelsTitle"
      descriptionKey="channelsDescription"
      state={{ ...READ_ONLY_SHELL, available: state.available }}
      readOnly
    >
      <InfoRows t={t} rows={state.rows} />
    </PluginCard>
  )
}
