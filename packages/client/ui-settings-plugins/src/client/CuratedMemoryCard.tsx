/** Curated MEMORY.md / USER.md master switch (Face `curated-memory.enabled`). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { CuratedMemoryCardFace } from './curated-memory-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the curated-memory card. */
export type CuratedMemoryCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<CuratedMemoryCardFace>

/**
 * Render the curated-memory master-switch card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function CuratedMemoryCard(props: CuratedMemoryCardProps) {
  const { t } = props
  const state = props.useCuratedMemoryCard(snapshot => snapshot)
  const disabled = !state.writable
  const enabled = state.enabled.text === 'false' ? 'false' : 'true'
  return (
    <PluginCard
      t={t}
      titleKey="curatedMemoryTitle"
      descriptionKey="curatedMemoryDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-curated-memory-enabled"
        label={t('curatedMemoryEnabled')}
        hint={t('curatedMemoryEnabledHint')}
        disabled={disabled}
        value={enabled}
        options={[
          { value: 'true', label: t('curatedMemoryEnabledOn') },
          { value: 'false', label: t('curatedMemoryEnabledOff') },
        ]}
        onChange={(value) => { props.edit('enabled', value) }}
      />
      <p className={css.note} role="note">{t('curatedMemoryLiveHint')}</p>
    </PluginCard>
  )
}
