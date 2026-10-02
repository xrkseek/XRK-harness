/**
 * Past-message edit / delete choreography:
 * - Delete → confirm modal immediately (truncate + optional file revert).
 * - Edit → stage into the composer first; confirm only when the user sends.
 * apply.tsx / InputHub await {@link requestResubmitConfirm}; ChatView calls
 * {@link completeResubmitConfirm} from ResubmitConfirm.
 */
export type ResubmitIntentKind = 'edit' | 'delete'

export type ResubmitIntent = {
  readonly sessionId: string
  readonly kind: ResubmitIntentKind
  readonly seq: number
  readonly text?: string
}

/** Composer-staged edit: message text is in the draft, confirm deferred to send. */
export type EditStaging = {
  readonly sessionId: string
  readonly seq: number
}

export type ResubmitConfirmChoice = 'cancel' | 'keep-files' | 'revert-files'

type Listener = () => void

let intent: ResubmitIntent | null = null
let resolveChoice: ((choice: ResubmitConfirmChoice) => void) | null = null
let staging: EditStaging | null = null
const listeners = new Set<Listener>()
const stagingListeners = new Set<Listener>()

function publish(): void {
  for (const listener of [...listeners]) listener()
}

function publishStaging(): void {
  for (const listener of [...stagingListeners]) listener()
}

/** Subscribe to confirm-modal intent changes (ChatView). */
export function subscribeResubmitIntent(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Current pending confirm intent, if any. */
export function getResubmitIntent(): ResubmitIntent | null {
  return intent
}

/** Subscribe to composer edit-staging changes (InputBar banner). */
export function subscribeEditStaging(listener: Listener): () => void {
  stagingListeners.add(listener)
  return () => { stagingListeners.delete(listener) }
}

/** Current composer-staged edit, if any. */
export function getEditStaging(): EditStaging | null {
  return staging
}

/**
 * Put one past user message into edit-resubmit staging (composer already seeded).
 * Replaces any prior staging for another message.
 */
export function beginEditStaging(next: EditStaging): void {
  staging = next
  publishStaging()
}

/** Drop composer edit staging without confirming. */
export function clearEditStaging(): void {
  if (staging === null) return
  staging = null
  publishStaging()
}

/**
 * Take staging for this session when the composer send path commits (one-shot).
 * Prefer {@link peekEditStagingFor} until the user confirms.
 * @returns the staged seq, or null when this send is an ordinary prompt.
 */
export function takeEditStagingFor(sessionId: string): EditStaging | null {
  if (staging === null || staging.sessionId !== sessionId) return null
  const taken = staging
  staging = null
  publishStaging()
  return taken
}

/** Read staging without consuming it (confirm-before-send). */
export function peekEditStagingFor(sessionId: string): EditStaging | null {
  if (staging === null || staging.sessionId !== sessionId) return null
  return staging
}

/**
 * Show the confirm modal and wait for Cancel / Don't revert / Revert.
 * @param next - edit or delete intent for one session message.
 */
export function requestResubmitConfirm(next: ResubmitIntent): Promise<ResubmitConfirmChoice> {
  if (resolveChoice !== null) {
    resolveChoice('cancel')
    resolveChoice = null
  }
  intent = next
  publish()
  return new Promise((resolve) => {
    resolveChoice = resolve
  })
}

/** Complete the pending confirm from the ChatView modal. */
export function completeResubmitConfirm(choice: ResubmitConfirmChoice): void {
  const done = resolveChoice
  resolveChoice = null
  intent = null
  publish()
  done?.(choice)
}
