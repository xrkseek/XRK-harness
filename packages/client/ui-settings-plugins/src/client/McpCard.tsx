/** MCP desired-server card: edit draft servers; connected overlay stays read-only. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconPlusOutline16, IconTrashOutline16 } from '@xrkseek/client-ui-primitives'
import { ValueField } from './fields.tsx'
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
          ? <p className={css.hint}>{t('mcpConnectedEmpty')}</p>
          : (
            <ul className={css.connectedList}>
              {state.connected.map(entry => (
                <li key={entry.id} className={css.connectedRow}>
                  <span className={css.connectedName}>{entry.serverName}</span>
                  <span className={css.badge}>{entry.kind}</span>
                  <span className={css.badgeMuted}>
                    {entry.toolCount}
                    {' '}
                    {t('mcpToolsLabel')}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>
      <section className={css.block} aria-label={t('mcpServersHeading')}>
        <div className={css.serversHead}>
          <h3 className={css.heading}>{t('mcpServersHeading')}</h3>
          <button
            type="button"
            className={css.add}
            disabled={disabled}
            onClick={() => { props.addRow() }}
          >
            <IconPlusOutline16 size={14} />
            {t('mcpAddServer')}
          </button>
        </div>
        {state.rows.length === 0
          ? <p className={css.hint}>{t('mcpServersEmpty')}</p>
          : state.rows.map((row, index) => (
            <ServerRow
              key={`mcp-row-${String(index)}`}
              t={t}
              index={index}
              row={row}
              disabled={disabled}
              onEdit={props.editRow}
              onRemove={props.removeRow}
            />
          ))}
        {state.rowInvalid ? <p className={css.invalid} role="status">{t('mcpRowInvalid')}</p> : null}
      </section>
    </PluginCard>
  )
}

interface ServerRowProps {
  t: McpCardProps['t']
  index: number
  row: McpServerRow
  disabled: boolean
  onEdit: McpCardFace['editRow']
  onRemove: McpCardFace['removeRow']
}

function ServerRow({ t, index, row, disabled, onEdit, onRemove }: ServerRowProps) {
  const transport = row.transport
  return (
    <div className={css.row}>
      <div className={css.rowHead}>
        <span className={css.rowTitle}>{t('mcpServerRow').replace('{index}', String(index + 1))}</span>
        <button
          type="button"
          className={css.remove}
          disabled={disabled}
          aria-label={t('mcpRemoveServer')}
          onClick={() => { onRemove(index) }}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
      <ValueField
        id={`plugin-config-mcp-name-${String(index)}`}
        label={t('mcpServerName')}
        hint={t('mcpServerNameHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('mcpRowInvalid')}
        disabled={disabled}
        text={row.serverName}
        overridden={false}
        invalid={row.serverName.trim() === ''}
        onEdit={(text) => { onEdit(index, { serverName: text }) }}
        onReset={() => { onEdit(index, { serverName: '' }) }}
      />
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor={`plugin-config-mcp-transport-${String(index)}`}>
            {t('mcpTransport')}
          </label>
        </div>
        <select
          id={`plugin-config-mcp-transport-${String(index)}`}
          className={css.select}
          disabled={disabled}
          value={transport}
          onChange={(event) => {
            onEdit(index, { transport: event.target.value as McpTransport })
          }}
        >
          <option value="stdio">{t('mcpTransportStdio')}</option>
          <option value="http">{t('mcpTransportHttp')}</option>
        </select>
        <p className={css.hint}>{t('mcpTransportHint')}</p>
      </div>
      {transport === 'stdio'
        ? (
          <ValueField
            id={`plugin-config-mcp-command-${String(index)}`}
            label={t('mcpCommand')}
            hint={t('mcpCommandHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('mcpRowInvalid')}
            disabled={disabled}
            text={row.command}
            overridden={false}
            invalid={row.command.trim() === ''}
            onEdit={(text) => { onEdit(index, { command: text }) }}
            onReset={() => { onEdit(index, { command: '' }) }}
          />
        )
        : (
          <ValueField
            id={`plugin-config-mcp-url-${String(index)}`}
            label={t('mcpUrl')}
            hint={t('mcpUrlHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('mcpRowInvalid')}
            disabled={disabled}
            text={row.url}
            overridden={false}
            invalid={row.url.trim() === ''}
            onEdit={(text) => { onEdit(index, { url: text }) }}
            onReset={() => { onEdit(index, { url: '' }) }}
          />
        )}
      <ValueField
        id={`plugin-config-mcp-args-${String(index)}`}
        label={t('mcpArgs')}
        hint={t('mcpArgsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('mcpRowInvalid')}
        disabled={disabled}
        text={row.args}
        overridden={false}
        invalid={false}
        onEdit={(text) => { onEdit(index, { args: text }) }}
        onReset={() => { onEdit(index, { args: '' }) }}
      />
      <ValueField
        id={`plugin-config-mcp-cwd-${String(index)}`}
        label={t('mcpCwd')}
        hint={t('mcpCwdHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('mcpRowInvalid')}
        disabled={disabled}
        text={row.cwd}
        overridden={false}
        invalid={false}
        onEdit={(text) => { onEdit(index, { cwd: text }) }}
        onReset={() => { onEdit(index, { cwd: '' }) }}
      />
    </div>
  )
}
