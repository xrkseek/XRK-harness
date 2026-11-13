/** MCP desired-server card: allow toggle, per-row status, JSON paste. */

import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import {
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
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
  const wsPasteRef = useRef<HTMLTextAreaElement>(null)
  const [pasteHint, setPasteHint] = useState<string | undefined>()
  const [wsPasteHint, setWsPasteHint] = useState<string | undefined>()

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
      {state.rows.some(row => row.transport === 'stdio' && row.cwd.trim())
        ? (
          <label className={css.allowRow}>
            <input
              type="checkbox"
              checked={state.rows
                .filter(row => row.transport === 'stdio' && row.cwd.trim())
                .every(row => row.cwdAllowWorkspace)}
              disabled={disabled}
              onChange={(event) => { props.setAllowWorkspaceCwd(event.target.checked) }}
            />
            <span>
              <span className={css.allowTitle}>{t('mcpAllowWorkspaceCwd')}</span>
              <span className={css.allowHint}>{t('mcpAllowWorkspaceCwdHint')}</span>
            </span>
          </label>
        )
        : null}
      {state.showErrors && state.cwdNeedsAck
        ? <p className={css.invalid} role="status">{t('mcpCwdNeedsAck')}</p>
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
                  loginOauth={props.loginOauth}
                  logoutOauth={props.logoutOauth}
                  cancelOauth={props.cancelOauth}
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
          <IconPlusOutlineRegular size={14} />
          {t('mcpAddServer')}
        </button>
        {pasteHint ? <p className={css.invalid} role="status">{pasteHint}</p> : null}
      </section>
      <section className={css.block} aria-label={t('mcpWorkspaceHeading')}>
        <h3 className={css.heading}>{t('mcpWorkspaceHeading')}</h3>
        <p className={css.empty}>{t('mcpWorkspaceHint')}</p>
        {state.workspaceOptions.length === 0
          ? <p className={css.empty}>{t('mcpWorkspaceEmpty')}</p>
          : (
            <>
              <label className={css.pasteLabel} htmlFor="plugin-config-mcp-ws">
                {t('mcpWorkspaceSelect')}
              </label>
              <select
                id="plugin-config-mcp-ws"
                className={css.paste}
                disabled={disabled}
                value={state.selectedWorkspaceId}
                onChange={(event) => { props.selectWorkspace(event.target.value) }}
              >
                {state.workspaceOptions.map(opt => (
                  <option key={opt.workspaceId} value={opt.workspaceId}>
                    {opt.title}
                  </option>
                ))}
              </select>
              {state.rows.length > 0
                ? (
                  <div className={css.block} aria-label={t('mcpDenyGlobalHeading')}>
                    <h3 className={css.heading}>{t('mcpDenyGlobalHeading')}</h3>
                    <p className={css.empty}>{t('mcpDenyGlobalHint')}</p>
                    <ul className={css.list}>
                      {state.rows.map(row => (
                        <li key={`deny-${row.serverName}`} className={css.entry}>
                          <label className={css.allowRow}>
                            <input
                              type="checkbox"
                              checked={state.denyGlobal.includes(row.serverName)}
                              disabled={disabled}
                              onChange={() => { props.toggleDenyGlobal(row.serverName) }}
                            />
                            <span className={css.allowTitle}>{row.serverName}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
                : null}
              <h3 className={css.heading}>{t('mcpWorkspaceServersHeading')}</h3>
              {state.workspaceRows.length === 0
                ? <p className={css.empty}>{t('mcpWorkspaceServersEmpty')}</p>
                : (
                  <ul className={css.list}>
                    {state.workspaceRows.map((row, index) => (
                      <ServerSummary
                        key={`mcp-ws-${row.serverName}-${String(index)}`}
                        t={t}
                        row={row}
                        disabled={disabled}
                        hideOauth
                        onRemove={() => { props.removeWorkspaceRow(index) }}
                        loginOauth={() => {}}
                        logoutOauth={() => {}}
                        cancelOauth={() => {}}
                      />
                    ))}
                  </ul>
                )}
              <label className={css.pasteLabel} htmlFor="plugin-config-mcp-ws-paste">
                {t('mcpPaste')}
              </label>
              <textarea
                id="plugin-config-mcp-ws-paste"
                ref={wsPasteRef}
                className={css.paste}
                disabled={disabled}
                placeholder={t('mcpPasteHint')}
                rows={6}
                spellCheck={false}
              />
              <div className={css.entryHead}>
                <button
                  type="button"
                  className={css.add}
                  disabled={disabled}
                  onClick={() => {
                    const pasted = wsPasteRef.current?.value ?? ''
                    const result = props.addWorkspaceRow(pasted)
                    if (result === 'ok' && wsPasteRef.current) wsPasteRef.current.value = ''
                    setWsPasteHint(
                      result === 'ok'
                        ? undefined
                        : result === 'empty'
                          ? t('mcpPasteEmpty')
                          : t('mcpPasteInvalid'),
                    )
                  }}
                >
                  <IconPlusOutlineRegular size={14} />
                  {t('mcpAddServer')}
                </button>
                <button
                  type="button"
                  className={css.add}
                  disabled={disabled || state.workspaceSaving || !state.workspaceDirty}
                  onClick={() => { props.saveWorkspace() }}
                >
                  {t('mcpWorkspaceSave')}
                </button>
                <button
                  type="button"
                  className={css.remove}
                  disabled={disabled || !state.workspaceDirty}
                  onClick={() => { props.discardWorkspace() }}
                >
                  {t('mcpWorkspaceDiscard')}
                </button>
              </div>
              {wsPasteHint ? <p className={css.invalid} role="status">{wsPasteHint}</p> : null}
              {state.workspaceFailed
                ? <p className={css.invalid} role="status">{state.workspaceNote}</p>
                : state.workspaceNote
                  ? <p className={css.empty}>{state.workspaceNote}</p>
                  : null}
            </>
          )}
      </section>
    </PluginCard>
  )
}

interface ServerSummaryProps {
  t: McpCardProps['t']
  row: McpServerRow
  disabled: boolean
  /** Workspace overlay rows: paste-only; OAuth stays on the global list. */
  hideOauth?: boolean
  onRemove: () => void
  loginOauth: (serverName: string) => void
  logoutOauth: (serverName: string) => void
  cancelOauth: (serverName: string) => void
}

function statusCopy(t: McpCardProps['t'], status: McpRowStatus): string {
  switch (status) {
    case 'connected':
      return t('mcpStatusConnected')
    case 'reconnecting':
      return t('mcpStatusReconnecting')
    case 'gave-up':
      return t('mcpStatusGaveUp')
    case 'connecting':
      return t('mcpStatusConnecting')
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
  if (status === 'connecting' || status === 'reconnecting') return css.badgeWarn
  return css.badgeMuted
}

function statusBadge(status: McpRowStatus): string {
  return `${css.badge} ${statusTone(status)}`
}

function ServerSummary({
  t, row, disabled, hideOauth, onRemove, loginOauth, logoutOauth, cancelOauth,
}: ServerSummaryProps) {
  const summary = row.transport === 'http'
    ? row.url
    : [row.command, row.args].filter(part => part.trim()).join(' ')
  const cwdLine = row.transport === 'stdio' && row.cwd.trim()
    ? `${t('mcpCwd')}: ${row.cwd.trim()}`
    : undefined
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
          {cwdLine ? <p className={css.empty}>{cwdLine}</p> : null}
          {row.failureMessage
            ? <p className={css.invalid} role="status">{row.failureMessage}</p>
            : null}
          {!hideOauth && row.transport === 'http'
            ? (
              <OauthRow
                t={t}
                row={row}
                disabled={disabled}
                onLogin={() => { loginOauth(row.serverName) }}
                onLogout={() => { logoutOauth(row.serverName) }}
                onCancel={() => { cancelOauth(row.serverName) }}
              />
            )
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
          <IconTrashOutlineRegular size={14} />
        </button>
      </div>
    </li>
  )
}

interface OauthRowProps {
  t: McpCardProps['t']
  row: McpServerRow
  disabled: boolean
  onLogin: () => void
  onLogout: () => void
  onCancel: () => void
}

function formatExpiresAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

/** IdP has no RFC 8628 device endpoint (wire may fold code into bad-request). */
function isNoDeviceOauthError(oauth: NonNullable<McpServerRow['oauth']>): boolean {
  if (oauth.errorCode === 'mcp-oauth-no-device') return true
  return /mcp-oauth-no-device|does not advertise device-code/i.test(oauth.error ?? '')
}

function oauthStatusCopy(t: McpCardProps['t'], row: McpServerRow): string {
  const oauth = row.oauth
  if (!oauth) return t('mcpOauthUnknown')
  if (oauth.busy) return t('mcpOauthBusy')
  if (oauth.phase === 'pending' && oauth.userCode) {
    return t('mcpOauthPendingCode').replace('{code}', oauth.userCode)
  }
  if (oauth.phase === 'pending') return t('mcpOauthPending')
  if (oauth.phase === 'error') {
    if (isNoDeviceOauthError(oauth)) {
      return oauth.error
        ? t('mcpOauthNoDeviceDetail').replace('{message}', oauth.error)
        : t('mcpOauthNoDevice')
    }
    return oauth.error
      ? t('mcpOauthErrorDetail').replace('{message}', oauth.error)
      : t('mcpOauthError')
  }
  if (oauth.loggedIn && oauth.expired) return t('mcpOauthExpired')
  if (oauth.loggedIn || oauth.phase === 'logged-in') {
    const bits = [t('mcpOauthLoggedIn')]
    if (oauth.expiresAt !== undefined) {
      bits.push(t('mcpOauthExpiresAt').replace('{when}', formatExpiresAt(oauth.expiresAt)))
    }
    if (oauth.hasRefreshToken) bits.push(t('mcpOauthHasRefresh'))
    return bits.join(' · ')
  }
  return t('mcpOauthLoggedOut')
}

function OauthRow({ t, row, disabled, onLogin, onLogout, onCancel }: OauthRowProps) {
  const oauth = row.oauth
  const busy = oauth?.busy === true
  const loggedIn = oauth?.loggedIn === true || oauth?.phase === 'logged-in'
  const pending = oauth?.phase === 'pending'
  const verifyUri = oauth?.verificationUriComplete || oauth?.verificationUri
  const userCode = oauth?.userCode

  const copyCode = async () => {
    if (!userCode) return
    try {
      await navigator.clipboard.writeText(userCode)
    } catch {
      /* clipboard may be denied */
    }
  }

  return (
    <div className={css.oauthBlock}>
      <p className={css.oauthStatus} role="status">{oauthStatusCopy(t, row)}</p>
      {pending && verifyUri
        ? (
          <a
            className={css.oauthLink}
            href={verifyUri}
            target="_blank"
            rel="noreferrer"
          >
            {t('mcpOauthOpenVerify')}
          </a>
        )
        : null}
      <div className={css.oauthActions}>
        {pending
          ? (
            <>
              {userCode
                ? (
                  <button
                    type="button"
                    className={css.oauthBtn}
                    disabled={disabled || busy}
                    onClick={() => { void copyCode() }}
                  >
                    {t('mcpOauthCopyCode')}
                  </button>
                )
                : null}
              <button
                type="button"
                className={css.oauthBtn}
                disabled={disabled || busy}
                onClick={onCancel}
              >
                {t('mcpOauthCancel')}
              </button>
            </>
          )
          : loggedIn
            ? (
              <button
                type="button"
                className={css.oauthBtn}
                disabled={disabled || busy}
                onClick={onLogout}
              >
                {t('mcpOauthLogout')}
              </button>
            )
            : (
              <button
                type="button"
                className={css.oauthBtn}
                disabled={disabled || busy}
                onClick={onLogin}
              >
                {t('mcpOauthLogin')}
              </button>
            )}
      </div>
    </div>
  )
}
