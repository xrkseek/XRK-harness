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

function ServerSummary({ t, row, disabled, onRemove, loginOauth, logoutOauth, cancelOauth }: ServerSummaryProps) {
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
          {row.transport === 'http'
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
          <IconTrashOutline16 size={14} />
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
