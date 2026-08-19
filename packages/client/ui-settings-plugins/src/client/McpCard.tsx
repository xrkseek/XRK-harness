/** MCP desired-server card: edit draft servers; connected overlay stays read-only.
 *
 * Vertical forms like Bash / WebSearch. One launch line for stdio; Local/Remote
 * segment instead of a mismatched native select; soft errors after Save.
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconPlusOutline16,
  IconTrashOutline16,
} from '@xrkseek/client-ui-primitives'
import { PlainField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import {
  applyLaunch,
  joinLaunch,
  suggestServerName,
  type McpCardFace,
  type McpServerRow,
  type McpTransport,
} from './mcp-card-controller.ts'
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
  const focusIndex = useRef<number | null>(null)

  useEffect(() => {
    const index = focusIndex.current
    if (index === null) return
    focusIndex.current = null
    document.getElementById(`plugin-config-mcp-name-${String(index)}`)?.focus()
  }, [state.rows.length])

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
            <div className={css.list}>
              {state.rows.map((row, index) => (
                <ServerEntry
                  key={`mcp-row-${String(index)}`}
                  t={t}
                  index={index}
                  row={row}
                  disabled={disabled}
                  showErrors={state.showErrors}
                  onEdit={props.editRow}
                  onSuggestName={() => { props.suggestName(index) }}
                  onRemove={() => { props.removeRow(index) }}
                />
              ))}
            </div>
          )}
        <button
          type="button"
          className={css.add}
          disabled={disabled}
          onClick={() => {
            focusIndex.current = state.rows.length
            props.addRow()
          }}
        >
          <IconPlusOutline16 size={14} />
          {t('mcpAddServer')}
        </button>
        {state.showErrors ? <p className={css.invalid} role="status">{t('mcpRowInvalid')}</p> : null}
      </section>
    </PluginCard>
  )
}

interface ServerEntryProps {
  t: McpCardProps['t']
  index: number
  row: McpServerRow
  disabled: boolean
  showErrors: boolean
  onEdit: McpCardFace['editRow']
  onSuggestName: () => void
  onRemove: () => void
}

function ServerEntry({
  t, index, row, disabled, showErrors, onEdit, onSuggestName, onRemove,
}: ServerEntryProps) {
  const [more, setMore] = useState(() => row.cwd.trim().length > 0)
  const n = String(index + 1)
  const title = row.serverName.trim() || t('mcpServerRow').replace('{index}', n)
  const nameInvalid = showErrors && row.serverName.trim() === ''
  const endpointInvalid = showErrors && (
    row.transport === 'http'
      ? row.url.trim() === ''
      : joinLaunch(row.command, row.args).trim() === ''
  )
  const nameHint = suggestServerName(row)

  return (
    <article className={css.entry} aria-label={title}>
      <div className={css.entryHead}>
        <h4 className={css.entryTitle}>{title}</h4>
        <button
          type="button"
          className={css.remove}
          aria-label={`${t('mcpRemoveServer')} ${n}`}
          title={t('mcpRemoveServer')}
          disabled={disabled}
          onClick={onRemove}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
      <div className={css.entryBody}>
        <PlainField
          id={`plugin-config-mcp-name-${String(index)}`}
          label={t('mcpServerName')}
          hint={t('mcpServerNameHint')}
          value={row.serverName}
          placeholder={nameHint || undefined}
          invalid={nameInvalid}
          disabled={disabled}
          onChange={(value) => { onEdit(index, { serverName: value }) }}
          onBlur={onSuggestName}
        />
        <div className={css.transport}>
          <span className={css.transportLabel} id={`plugin-config-mcp-transport-label-${String(index)}`}>
            {t('mcpTransport')}
          </span>
          <div
            className={css.segment}
            role="group"
            aria-labelledby={`plugin-config-mcp-transport-label-${String(index)}`}
          >
            <TransportOption
              active={row.transport === 'stdio'}
              disabled={disabled}
              label={t('mcpTransportStdio')}
              onSelect={() => { onEdit(index, { transport: 'stdio' satisfies McpTransport }) }}
            />
            <TransportOption
              active={row.transport === 'http'}
              disabled={disabled}
              label={t('mcpTransportHttp')}
              onSelect={() => { onEdit(index, { transport: 'http' satisfies McpTransport }) }}
            />
          </div>
          <p className={css.transportHint}>{t('mcpTransportHint')}</p>
        </div>
        {row.transport === 'http'
          ? (
            <PlainField
              id={`plugin-config-mcp-url-${String(index)}`}
              label={t('mcpUrl')}
              hint={t('mcpUrlHint')}
              value={row.url}
              placeholder="https://"
              invalid={endpointInvalid}
              disabled={disabled}
              onChange={(value) => { onEdit(index, { url: value }) }}
              onBlur={onSuggestName}
            />
          )
          : (
            <>
              <PlainField
                id={`plugin-config-mcp-launch-${String(index)}`}
                label={t('mcpCommand')}
                hint={t('mcpCommandHint')}
                value={joinLaunch(row.command, row.args)}
                placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                invalid={endpointInvalid}
                disabled={disabled}
                onChange={(value) => { onEdit(index, applyLaunch(value)) }}
                onBlur={onSuggestName}
              />
              {more
                ? (
                  <PlainField
                    id={`plugin-config-mcp-cwd-${String(index)}`}
                    label={t('mcpCwd')}
                    hint={t('mcpCwdHint')}
                    value={row.cwd}
                    disabled={disabled}
                    onChange={(value) => { onEdit(index, { cwd: value }) }}
                  />
                )
                : (
                  <button
                    type="button"
                    className={css.more}
                    disabled={disabled}
                    onClick={() => { setMore(true) }}
                  >
                    {t('mcpMore')}
                  </button>
                )}
            </>
          )}
      </div>
    </article>
  )
}

function TransportOption(props: {
  active: boolean
  disabled: boolean
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={props.active ? css.segmentActive : css.segmentBtn}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      {props.label}
    </button>
  )
}
