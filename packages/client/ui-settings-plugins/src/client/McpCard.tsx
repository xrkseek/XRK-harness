/** MCP desired-server card: edit draft servers; connected overlay stays read-only.
 *
 * Each server is a vertical form (label + control + hint), matching Bash /
 * WebSearch cards and DSH settings posture — no placeholder-only primary row.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconPlusOutline16,
  IconTrashOutline16,
} from '@xrkseek/client-ui-primitives'
import fieldCss from './fields.module.css'
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
                  onEdit={props.editRow}
                  onRemove={() => { props.removeRow(index) }}
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
  onEdit: McpCardFace['editRow']
  onRemove: () => void
}

function ServerEntry({
  t, index, row, disabled, onEdit, onRemove,
}: ServerEntryProps) {
  const n = String(index + 1)
  const rowLabel = t('mcpServerRow').replace('{index}', n)
  const nameInvalid = row.serverName.trim() === ''
  const endpointInvalid = row.transport === 'http'
    ? row.url.trim() === ''
    : row.command.trim() === ''

  return (
    <article className={css.entry} aria-label={rowLabel}>
      <div className={css.entryHead}>
        <h4 className={css.entryTitle}>{rowLabel}</h4>
        <button
          type="button"
          className={css.remove}
          aria-label={`${t('mcpRemoveServer')} ${n}`}
          title={t('mcpRemoveServer')}
          disabled={disabled}
          onClick={onRemove}
        >
          <IconTrashOutline16 size={14} />
          {t('mcpRemoveServer')}
        </button>
      </div>
      <div className={css.entryBody}>
        <McpTextField
          id={`plugin-config-mcp-name-${String(index)}`}
          label={t('mcpServerName')}
          hint={t('mcpServerNameHint')}
          value={row.serverName}
          invalid={nameInvalid}
          disabled={disabled}
          onChange={(value) => { onEdit(index, { serverName: value }) }}
        />
        <McpSelectField
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
            <McpTextField
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
              <McpTextField
                id={`plugin-config-mcp-command-${String(index)}`}
                label={t('mcpCommand')}
                hint={t('mcpCommandHint')}
                value={row.command}
                invalid={endpointInvalid}
                disabled={disabled}
                onChange={(value) => { onEdit(index, { command: value }) }}
              />
              <McpTextField
                id={`plugin-config-mcp-args-${String(index)}`}
                label={t('mcpArgs')}
                hint={t('mcpArgsHint')}
                value={row.args}
                disabled={disabled}
                onChange={(value) => { onEdit(index, { args: value }) }}
              />
              <McpTextField
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

interface McpTextFieldProps {
  id: string
  label: string
  hint: string
  value: string
  disabled: boolean
  invalid?: boolean
  onChange: (value: string) => void
}

function McpTextField({
  id, label, hint, value, disabled, invalid = false, onChange,
}: McpTextFieldProps) {
  return (
    <div className={fieldCss.field}>
      <label className={fieldCss.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        className={invalid ? fieldCss.inputInvalid : fieldCss.input}
        type="text"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => { onChange(event.target.value) }}
      />
      <p className={fieldCss.hint}>{hint}</p>
    </div>
  )
}

interface McpSelectFieldProps {
  id: string
  label: string
  hint: string
  value: string
  disabled: boolean
  options: readonly { readonly value: string; readonly label: string }[]
  onChange: (value: string) => void
}

function McpSelectField({
  id, label, hint, value, disabled, options, onChange,
}: McpSelectFieldProps) {
  return (
    <div className={fieldCss.field}>
      <label className={fieldCss.label} htmlFor={id}>{label}</label>
      <select
        id={id}
        className={fieldCss.select}
        value={value}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value) }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <p className={fieldCss.hint}>{hint}</p>
    </div>
  )
}
