/** Curated MEMORY.md / USER.md switches (Face `curated-memory`). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { CuratedMemoryCardFace } from './curated-memory-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the curated-memory card. */
export type CuratedMemoryCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<CuratedMemoryCardFace>

/**
 * Render the curated-memory card (master switch + optional Phase2 LLM).
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function CuratedMemoryCard(props: CuratedMemoryCardProps) {
  const { t } = props
  const state = props.useCuratedMemoryCard(snapshot => snapshot)
  const disabled = !state.writable
  const enabled = state.enabled.text !== 'false'
  const phase2Llm = state.phase2Llm.text === 'true' ? 'true' : 'false'
  return (
    <PluginCard
      t={t}
      titleKey="curatedMemoryTitle"
      descriptionKey="curatedMemoryDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(enabled, (value) => { props.edit('enabled', value) })}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.note} role="note">{t('curatedMemoryEnabledHint')}</p>
      <SelectField
        id="plugin-config-curated-memory-phase2"
        label={t('curatedMemoryPhase2')}
        hint={t('curatedMemoryPhase2Hint')}
        disabled={disabled || !enabled}
        value={phase2Llm}
        options={[
          { value: 'false', label: t('curatedMemoryPhase2Off') },
          { value: 'true', label: t('curatedMemoryPhase2On') },
        ]}
        onChange={(value) => { props.edit('phase2Llm', value) }}
      />
      <p className={css.note} role="note">{t('curatedMemoryLiveHint')}</p>
    </PluginCard>
  )
}
