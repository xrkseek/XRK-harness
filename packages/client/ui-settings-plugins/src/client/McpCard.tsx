/** MCP desired-server card: edit draft servers; connected overlay stays read-only.
 *
 * Row chrome follows DSH Models `ModelListEditor` (XRKbar): compact bordered
 * entries, primary grid + expandable secondary fields, pill add, glyph trash.
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconChevronDownOutline14,
  IconPlusOutline16,
  IconTrashOutline16,
} from '@xrkseek/client-ui-primitives'
import { PluginCard } from './PluginCard.tsx'
import type { McpCardFace, McpServerRow, McpTransport } from './mcp-card-controller.ts'
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
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const prevLen = useRef(state.rows.length)

  // A newly appended row opens its advanced fields (args / cwd), matching DSH
  // model-list posture where secondary capacity starts available after Add.
  useEffect(() => {
    if (state.rows.length > prevLen.current) {
      setExpanded((current) => {
        const next = new Set(current)
        next.add(state.rows.length - 1)
        return next
      })
    }
    prevLen.current = state.rows.length
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
      <section className={css.block} aria-label={t('mcpConnectedHeading')}>
        <h3 className={css.heading}>{t('mcpConnectedHeading')}</h3>
        {state.connected.length === 0
          ? <p className={css.empty}>{t('mcpConnectedEmpty')}</p>
          : (
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
                    <span className={css.badgeMuted}>{entry.kind}</span>
                    <span className={css.badgeMuted}>
                      {entry.toolCount}
                      {' '}
                      {t('mcpToolsLabel')}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
      </section>
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
                  open={expanded.has(index)}
                  onToggle={() => {
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    })
                  }}
                  onEdit={props.editRow}
                  onRemove={() => {
                    props.removeRow(index)
                    setExpanded((current) => {
                      const next = new Set<number>()
                      for (const at of current) {
                        if (at < index) next.add(at)
                        else if (at > index) next.add(at - 1)
                      }
                      return next
                    })
                  }}
                />
              ))}
            </div>
          )}
        <button
          type="button"
          className={css.add}
          disabled={disabled}
          onClick={() => { props.addRow() }}
        >
          <IconPlusOutline16 size={14} />
          {t('mcpAddServer')}
        </button>
        {state.rowInvalid ? <p className={css.invalid} role="status">{t('mcpRowInvalid')}</p> : null}
      </section>
    </PluginCard>
  )
}

interface ServerEntryProps {
  t: McpCardProps['t']
  index: number
  row: McpServerRow
  disabled: boolean
  open: boolean
  onToggle: () => void
  onEdit: McpCardFace['editRow']
  onRemove: () => void
}

function ServerEntry({
  t, index, row, disabled, open, onToggle, onEdit, onRemove,
}: ServerEntryProps) {
  const n = String(index + 1)
  const nameInvalid = row.serverName.trim() === ''
  const endpointInvalid = row.transport === 'http'
    ? row.url.trim() === ''
    : row.command.trim() === ''
  return (
    <div className={css.entry}>
      <div className={css.primary}>
        <input
          id={`plugin-config-mcp-name-${String(index)}`}
          className={nameInvalid ? css.inputInvalid : css.input}
          type="text"
          value={row.serverName}
          placeholder={t('mcpServerName')}
          aria-label={`${t('mcpServerName')} ${n}`}
          aria-invalid={nameInvalid || undefined}
          disabled={disabled}
          onChange={(event) => { onEdit(index, { serverName: event.target.value }) }}
        />
        {row.transport === 'http'
          ? (
            <input
              id={`plugin-config-mcp-url-${String(index)}`}
              className={`${endpointInvalid ? css.inputInvalid : css.input} ${css.endpoint}`}
              type="text"
              value={row.url}
              placeholder={t('mcpUrl')}
              aria-label={`${t('mcpUrl')} ${n}`}
              aria-invalid={endpointInvalid || undefined}
              disabled={disabled}
              onChange={(event) => { onEdit(index, { url: event.target.value }) }}
            />
          )
          : (
            <input
              id={`plugin-config-mcp-command-${String(index)}`}
              className={`${endpointInvalid ? css.inputInvalid : css.input} ${css.endpoint}`}
              type="text"
              value={row.command}
              placeholder={t('mcpCommand')}
              aria-label={`${t('mcpCommand')} ${n}`}
              aria-invalid={endpointInvalid || undefined}
              disabled={disabled}
              onChange={(event) => { onEdit(index, { command: event.target.value }) }}
            />
          )}
        <select
          id={`plugin-config-mcp-transport-${String(index)}`}
          className={`${css.input} ${css.transport}`}
          disabled={disabled}
          value={row.transport}
          aria-label={`${t('mcpTransport')} ${n}`}
          onChange={(event) => {
            onEdit(index, { transport: event.target.value as McpTransport })
          }}
        >
          <option value="stdio">{t('mcpTransportStdio')}</option>
          <option value="http">{t('mcpTransportHttp')}</option>
        </select>
        <button
          type="button"
          className={css.iconButton}
          aria-label={`${t('mcpAdvanced')} ${n}`}
          aria-expanded={open}
          title={t('mcpAdvanced')}
          onClick={onToggle}
        >
          <IconChevronDownOutline14
            size={14}
            className={open ? css.iconOpen : undefined}
          />
        </button>
        <button
          type="button"
          className={`${css.iconButton} ${css.iconButtonDanger}`}
          aria-label={`${t('mcpRemoveServer')} ${n}`}
          title={t('mcpRemoveServer')}
          disabled={disabled}
          onClick={onRemove}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
      {open
        ? (
          <div className={css.advanced}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('mcpArgs')}</span>
              <input
                id={`plugin-config-mcp-args-${String(index)}`}
                className={css.input}
                type="text"
                value={row.args}
                placeholder={t('mcpArgsHint')}
                aria-label={`${t('mcpArgs')} ${n}`}
                disabled={disabled}
                onChange={(event) => { onEdit(index, { args: event.target.value }) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('mcpCwd')}</span>
              <input
                id={`plugin-config-mcp-cwd-${String(index)}`}
                className={css.input}
                type="text"
                value={row.cwd}
                placeholder={t('mcpCwdHint')}
                aria-label={`${t('mcpCwd')} ${n}`}
                disabled={disabled}
                onChange={(event) => { onEdit(index, { cwd: event.target.value }) }}
              />
            </label>
          </div>
        )
        : null}
    </div>
  )
}
