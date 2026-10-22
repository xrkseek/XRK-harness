/**
 * OS notification exit for session completion reminders.
 * Triggered from Manager's running true→false edge; focus policy defaults to
 * unfocused-only so an active chat does not spam the desktop.
 */

export type NotifyFocusPolicy = 'unfocused' | 'always'

export type OsNotifyInput = {
  readonly title: string
  readonly body: string
  readonly focusPolicy?: NotifyFocusPolicy
  /** Injected for tests; defaults to `document.hasFocus` when present. */
  readonly isFocused?: () => boolean
  readonly notify?: (title: string, body: string) => void
}

export function shouldOsNotify(input: {
  readonly focusPolicy: NotifyFocusPolicy
  readonly isFocused: () => boolean
}): boolean {
  if (input.focusPolicy === 'always') return true
  return !input.isFocused()
}

/**
 * Fire a completion notification when policy allows. No-ops when the
 * Notification API is missing or permission is denied.
 */
export function notifySessionCompleted(input: OsNotifyInput): void {
  const focusPolicy = input.focusPolicy ?? 'unfocused'
  const isFocused =
    input.isFocused
    ?? (() => typeof document !== 'undefined' && document.hasFocus())
  if (!shouldOsNotify({ focusPolicy, isFocused })) return

  const notify = input.notify ?? defaultNotify
  notify(input.title, input.body)
}

function defaultNotify(title: string, body: string): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'denied') return
  const show = () => {
    try {
      new Notification(title, { body })
    } catch {
      /* ignore */
    }
  }
  if (Notification.permission === 'granted') {
    show()
    return
  }
  void Notification.requestPermission().then((perm) => {
    if (perm === 'granted') show()
  })
}
