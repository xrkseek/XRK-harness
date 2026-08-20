/** MCP desired-server card: allow toggle, per-row status, JSON paste. */

import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconPlusOutline16,
  IconTrashOutline16,
} from '@xrkseek/client-ui-primitives'
import { PluginCard } from './PluginCard.tsx'
import type { McpCardFace, McpRowStatus, McpServerRow } from './mcp-card-controller.ts'
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
      <label className={css.allowRow}>
        <input
          type="checkbox"
          checked={state.allowConnect}
          disabled={disabled}
          onChange={(event) => { props.setAllowConnect(event.target.checked) }}
        />
        <span>
          <span className={css.allowTitle}>{t('mcpAllowConnect')}</span>
          <span className={css.allowHint}>{t('mcpAllowConnectHint')}</span>
        </span>
      </label>
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

function statusCopy(t: McpCardProps['t'], status: McpRowStatus): string {
  switch (status) {
    case 'connected':
      return t('mcpStatusConnected')
    case 'reconnecting':
      return t('mcpStatusReconnecting')
    case 'gave-up':
      return t('mcpStatusGaveUp')
    case 'parked':
      return t('mcpStatusParked')
    case 'failed':
      return t('mcpStatusFailed')
    default:
      return t('mcpStatusIdle')
  }
}

function statusTone(status: McpRowStatus): string {
  if (status === 'connected') return css.badgeOk
  if (status === 'failed' || status === 'gave-up') return css.badgeError
  if (status === 'parked') return css.badgeWarn
  return css.badgeMuted
}

function statusBadge(status: McpRowStatus): string {
  return `${css.badge} ${statusTone(status)}`
}

function ServerSummary({ t, row, disabled, onRemove }: ServerSummaryProps) {
  const summary = row.transport === 'http'
    ? row.url
    : [row.command, row.args].filter(part => part.trim()).join(' ')
  return (
    <li className={css.entry} aria-label={row.serverName} data-mcp-status={row.status}>
      <div className={css.entryHead}>
        <div>
          <div className={css.entryTitleRow}>
            <span className={`${css.statusDot} ${statusTone(row.status)}`} aria-hidden />
            <h4 className={css.entryTitle}>{row.serverName}</h4>
            <span className={statusBadge(row.status)}>{statusCopy(t, row.status)}</span>
            {row.toolCount > 0
              ? (
                <span className={`${css.badge} ${css.badgeMuted}`}>
                  {row.toolCount}
                  {' '}
                  {t('mcpToolsLabel')}
                </span>
              )
              : null}
          </div>
          <p className={css.empty}>{summary || t('mcpServerRow').replace('{index}', '')}</p>
          {row.failureMessage
            ? <p className={css.invalid} role="status">{row.failureMessage}</p>
            : null}
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
