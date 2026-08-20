/** MCP desired-server card: JSON-block paste only (Cursor / Trae style). */

import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconPlusOutline16,
  IconTrashOutline16,
} from '@xrkseek/client-ui-primitives'
import { PluginCard } from './PluginCard.tsx'
import type { McpCardFace, McpServerRow } from './mcp-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the MCP card. */
export type McpCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<McpCardFace>

/**
 * Render the MCP card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function McpCard(props: McpCardProps) {
  const { t } = props
  const state = props.useMcpCard(snapshot => snapshot)
  const disabled = !state.writable
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  const [pasteHint, setPasteHint] = useState<string | undefined>()

  const addFromPaste = () => {
    const pasted = pasteRef.current?.value ?? ''
    const result = props.addRow(pasted)
    if (result === 'ok') {
      if (pasteRef.current) pasteRef.current.value = ''
      setPasteHint(undefined)
      return
    }
    setPasteHint(result === 'empty' ? t('mcpPasteEmpty') : t('mcpPasteInvalid'))
  }

  return (
    <PluginCard
      t={t}
      titleKey="mcpTitle"
      descriptionKey="mcpDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {state.note
        ? (
          <p className={css.note} role="note">{state.note}</p>
        )
        : null}
      {state.connected.length > 0
        ? (
          <section className={css.block} aria-label={t('mcpConnectedHeading')}>
            <h3 className={css.heading}>{t('mcpConnectedHeading')}</h3>
            <ul className={css.connectedList}>
              {state.connected.map(entry => {
                const status = entry.status ?? 'connected'
                const statusClass = status === 'gave-up'
                  ? css.badgeError
                  : status === 'reconnecting'
                    ? css.badgeMuted
                    : css.badge
                const statusLabel = status === 'gave-up'
                  ? t('mcpStatusGaveUp')
                  : status === 'reconnecting'
                    ? t('mcpStatusReconnecting')
                    : t('mcpStatusConnected')
                return (
                  <li
                    key={entry.id}
                    className={css.connectedRow}
                    data-mcp-status={status}
                  >
                    <span className={css.connectedName}>{entry.serverName}</span>
                    <span className={statusClass}>{statusLabel}</span>
                    <span className={css.badgeMuted}>
                      {entry.toolCount}
                      {' '}
                      {t('mcpToolsLabel')}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
        : null}
      <section className={css.block} aria-label={t('mcpServersHeading')}>
        <h3 className={css.heading}>{t('mcpServersHeading')}</h3>
        {state.rows.length === 0
          ? <p className={css.empty}>{t('mcpServersEmpty')}</p>
          : (
            <ul className={css.list}>
              {state.rows.map((row, index) => (
                <ServerSummary
                  key={`mcp-row-${row.serverName}-${String(index)}`}
                  t={t}
                  row={row}
                  disabled={disabled}
                  onRemove={() => { props.removeRow(index) }}
                />
              ))}
            </ul>
          )}
        <label className={css.pasteLabel} htmlFor="plugin-config-mcp-paste">
          {t('mcpPaste')}
        </label>
        <textarea
          id="plugin-config-mcp-paste"
          ref={pasteRef}
          className={css.paste}
          disabled={disabled}
          placeholder={t('mcpPasteHint')}
          rows={8}
          spellCheck={false}
          onChange={() => { if (pasteHint) setPasteHint(undefined) }}
        />
        <button
          type="button"
          className={css.add}
          disabled={disabled}
          onClick={addFromPaste}
        >
          <IconPlusOutline16 size={14} />
          {t('mcpAddServer')}
        </button>
        {pasteHint ? <p className={css.invalid} role="status">{pasteHint}</p> : null}
      </section>
    </PluginCard>
  )
}

interface ServerSummaryProps {
  t: McpCardProps['t']
  row: McpServerRow
  disabled: boolean
  onRemove: () => void
}

function ServerSummary({ t, row, disabled, onRemove }: ServerSummaryProps) {
  const summary = row.transport === 'http'
    ? row.url
    : [row.command, row.args].filter(part => part.trim()).join(' ')
  return (
    <li className={css.entry} aria-label={row.serverName}>
      <div className={css.entryHead}>
        <div>
          <h4 className={css.entryTitle}>{row.serverName}</h4>
          <p className={css.empty}>{summary || t('mcpServerRow').replace('{index}', '')}</p>
        </div>
        <button
          type="button"
          className={css.remove}
          aria-label={`${t('mcpRemoveServer')} ${row.serverName}`}
          title={t('mcpRemoveServer')}
          disabled={disabled}
          onClick={onRemove}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
    </li>
  )
}
