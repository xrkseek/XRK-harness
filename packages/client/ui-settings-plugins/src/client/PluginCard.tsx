/**
 * One plugin's card: a header naming the plugin and what its settings govern,
 * disclosing that plugin's controls in place, with the save that writes them.
 *
 * Optional `masterSwitch` uses the shared DSH `Switch` atom — aria-label is the
 * card title unless overridden; callers do not ship per-switch locales.
 */

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, Switch } from '@xrkseek/client-ui-primitives'
import type { CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import { pluginArtwork } from './plugin-artwork.tsx'
import css from './PluginCard.module.css'

/** Header master switch (on/off) for pluggable Host modules. */
export interface PluginCardMasterSwitch {
  /** Whether the module is currently on (draft or live). */
  readonly checked: boolean
  /** When false, the switch is inert (read-only scope). */
  readonly disabled?: boolean
  /** Stage the next on/off value (caller owns edit + save). */
  readonly onChange: (next: boolean) => void
  /** Override aria-label; defaults to the card title. */
  readonly label?: string
}

/** Card chrome shared by every plugin section. */
export interface PluginCardProps {
  /** Locale reader for this section's copy. */
  t: (key: PluginsSettingsLocaleKey) => string
  /** Locale key of the plugin's name. */
  titleKey: PluginsSettingsLocaleKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: PluginsSettingsLocaleKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. Omitted by a read-only card. */
  onSave?: () => void
  /** Drop every staged edit. Omitted by a read-only card. */
  onDiscard?: () => void
  /** The plugin's controls. */
  children: ReactNode
  /** Show the section as information: the footer has nothing to write. */
  readOnly?: boolean
  /**
   * Optional status chip on the collapsed header (e.g. current mode).
   * Distinct from the unsaved pill — a live fact, not a draft warning.
   */
  badge?: string | undefined
  /**
   * Optional DSH-style header switch. When set, the header splits into a
   * disclose button and a separate switch so toggling does not expand the card.
   */
  masterSwitch?: PluginCardMasterSwitch
  /**
   * When true, omit the outer card border (parent list supplies fused chrome).
   * Used by Plugins → Advanced.
   */
  embedded?: boolean
}

/**
 * Render one plugin card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function PluginCard(props: PluginCardProps) {
  const [open, setOpen] = useState(false)
  const { state } = props
  if (!state.available) return null
  const title = props.t(props.titleKey)
  const blocked = !state.dirty || state.invalid || state.saving
  const readOnly = props.readOnly === true || !state.writable
  const master = props.masterSwitch
  const switchDisabled = readOnly || master?.disabled === true || state.saving

  const head = (
    <>
      <span className={css.icon} aria-hidden="true">
        {pluginArtwork(props.titleKey)}
      </span>
      <span className={css.headText}>
        <span className={css.titleRow}>
          <span className={css.name}>{title}</span>
          {props.badge !== undefined && props.badge.length > 0
            ? <span className={css.badge}>{props.badge}</span>
            : null}
          {readOnly && props.readOnly === true
            ? <span className={css.badgeMuted}>{props.t('readOnly')}</span>
            : null}
        </span>
        <span className={css.description}>{props.t(props.descriptionKey)}</span>
      </span>
      {state.dirty ? <span className={css.pending}>{props.t('unsaved')}</span> : null}
      <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
    </>
  )

  return (
    <li className={clsx(css.card, props.embedded && css.embedded, open && css.cardOpen)}>
      {master
        ? (
          <div className={css.headerRow}>
            <button
              type="button"
              className={css.headerMain}
              aria-expanded={open}
              aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
              onClick={() => { setOpen(!open) }}
            >
              {head}
            </button>
            <Switch
              checked={master.checked}
              aria-label={master.label ?? title}
              disabled={switchDisabled}
              onCheckedChange={(next) => {
                master.onChange(next)
                if (next) setOpen(true)
              }}
            />
          </div>
        )
        : (
          <button
            type="button"
            className={css.header}
            aria-expanded={open}
            aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
            onClick={() => { setOpen(!open) }}
          >
            {head}
          </button>
        )}
      {open
        ? (
          <div className={css.body}>
            {!state.writable && props.readOnly !== true
              ? <p className={css.readOnly} role="status">{props.t('readOnly')}</p>
              : null}
            <div className={css.fields}>{props.children}</div>
            {props.readOnly === true
              ? null
              : (
                <div className={css.footer}>
                  {state.failed ? <p className={css.failed} role="status">{props.t('saveFailed')}</p> : null}
                  <button
                    type="button"
                    className={css.discard}
                    disabled={!state.dirty || state.saving}
                    onClick={() => { props.onDiscard?.() }}
                  >
                    {props.t('discard')}
                  </button>
                  <button
                    type="button"
                    className={css.save}
                    disabled={blocked}
                    onClick={() => { props.onSave?.() }}
                  >
                    {props.t(state.saving ? 'saving' : 'save')}
                  </button>
                </div>
              )}
          </div>
        )
        : null}
    </li>
  )
}
