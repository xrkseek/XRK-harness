/** Frame-wide reconnect banner; click-through layer stays pointer-events:none except the strip. */
import { ConnectionBanner } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import css from './ConnectionOverlay.module.css'

export type ConnectionOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'layout'>

/**
 * Top reconnect strip while the wire client is in backoff/retry.
 * @param props - global standard kit + layout locale seat.
 */
export function ConnectionOverlay({ useConnectionState, t }: ConnectionOverlayProps) {
  const reconnecting = useConnectionState(state => state === 'reconnecting')
  return (
    <div className={css.layer}>
      <ConnectionBanner reconnecting={reconnecting} label={t('connection.reconnecting')} />
    </div>
  )
}
