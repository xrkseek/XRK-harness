/** Auto-review classifier card (Face `auto-review`) on Plugins → Advanced. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { AutoReviewCardFace } from './auto-review-card-controller.ts'
import type {} from './advanced-slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the auto-review card. */
export type AutoReviewCardProps =
  PropsRuntime<'settings.plugin.advanced.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<AutoReviewCardFace>

/** Render the auto-review classifier card. */
export function AutoReviewCard(props: AutoReviewCardProps) {
  const { t } = props
  const state = props.useAutoReviewCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="autoReviewTitle"
      descriptionKey="autoReviewDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-advanced-auto-review-url"
        label={t('autoReviewClassifierUrl')}
        hint={t('autoReviewClassifierUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.classifierUrl}
        onEdit={(text) => { props.edit('classifierUrl', text) }}
        onReset={() => { props.resetField('classifierUrl') }}
      />
      <SecretField
        id="plugin-advanced-auto-review-token"
        label={t('autoReviewClassifierToken')}
        hint={t('autoReviewClassifierTokenHint')}
        disabled={!state.tokenWritable}
        text={state.classifierToken.text}
        configured={state.tokenConfigured}
        stateLabel={state.tokenConfigured
          ? t('autoReviewClassifierTokenSet')
          : t('autoReviewClassifierTokenUnset')}
        onEdit={(text) => { props.edit('classifierToken', text) }}
      />
      <p className={css.note} role="note">{t('autoReviewLiveHint')}</p>
    </PluginCard>
  )
}
