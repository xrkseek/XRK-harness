/** MCP desired-server card: edit draft servers; connected overlay stays read-only.
 *
 * Same vertical field stack as Agent / Bash (label + control + hint). All of
 * name / transport / command / args / cwd stay visible so they read alike —
 * no launch-line merge, no buried “advanced” cwd.
 */

import { useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconPlusOutline16,
  IconTrashOutline16,
} from '@xrkseek/client-ui-primitives'
import { PlainField, SelectField } from './fields.tsx'
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
  const pasteRef = useRef<HTMLTextAreaElement>(null)

  const addFromPasteOrBlank = () => {
    const pasted = pasteRef.current?.value ?? ''
    props.addRow(pasted)
    if (pasteRef.current) pasteRef.current.value = ''
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
                  onRemove={() => { props.removeRow(index) }}
                />
              ))}
            </div>
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
          rows={5}
          spellCheck={false}
        />
        <button
          type="button"
          className={css.add}
          disabled={disabled}
          onClick={addFromPasteOrBlank}
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
  onRemove: () => void
}

function ServerEntry({
  t, index, row, disabled, showErrors, onEdit, onRemove,
}: ServerEntryProps) {
  const n = String(index + 1)
  const title = row.serverName.trim() || t('mcpServerRow').replace('{index}', n)
  const nameInvalid = showErrors && row.serverName.trim() === ''
  const endpointInvalid = showErrors && (
    row.transport === 'http'
      ? row.url.trim() === ''
      : row.command.trim() === ''
  )

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
          invalid={nameInvalid}
          disabled={disabled}
          onChange={(value) => { onEdit(index, { serverName: value }) }}
        />
        <SelectField
          id={`plugin-config-mcp-transport-${String(index)}`}
          label={t('mcpTransport')}
          hint={t('mcpTransportHint')}
          value={row.transport}
          disabled={disabled}
          options={[
            { value: 'stdio', label: t('mcpTransportStdio') },
            { value: 'http', label: t('mcpTransportHttp') },
          ]}
          onChange={(value) => { onEdit(index, { transport: value as McpTransport }) }}
        />
        {row.transport === 'http'
          ? (
            <PlainField
              id={`plugin-config-mcp-url-${String(index)}`}
              label={t('mcpUrl')}
              hint={t('mcpUrlHint')}
              value={row.url}
              invalid={endpointInvalid}
              disabled={disabled}
              onChange={(value) => { onEdit(index, { url: value }) }}
            />
          )
          : (
            <>
              <PlainField
                id={`plugin-config-mcp-command-${String(index)}`}
                label={t('mcpCommand')}
                hint={t('mcpCommandHint')}
                value={row.command}
                invalid={endpointInvalid}
                disabled={disabled}
                onChange={(value) => { onEdit(index, { command: value }) }}
              />
              <PlainField
                id={`plugin-config-mcp-args-${String(index)}`}
                label={t('mcpArgs')}
                hint={t('mcpArgsHint')}
                value={row.args}
                disabled={disabled}
                onChange={(value) => { onEdit(index, { args: value }) }}
              />
              <PlainField
                id={`plugin-config-mcp-cwd-${String(index)}`}
                label={t('mcpCwd')}
                hint={t('mcpCwdHint')}
                value={row.cwd}
                disabled={disabled}
                onChange={(value) => { onEdit(index, { cwd: value }) }}
              />
            </>
          )}
      </div>
    </article>
  )
}
