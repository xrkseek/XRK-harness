/**
 * Frozen input contract. Types only. Three-tier visibility: business packages
 * see InputState via the InputZone currency; the scoped input events carry the
 * mutation verbs; the conversation wiring layer alone sees the full SessionInput.
 * Draft text and reference chips live in the shell's Lexical editor; the machine
 * is the submit plane (phase, claim, attempt) alone.
 */
import type { ClientContext, SnapshotStore } from '@xrkseek/client-runtime/client'
import type { Branded } from '@xrkseek/xrk-brand'
import type { LexicalEditor } from 'lexical'
import type {
  ArbitrateKey, ArbitrateOutcome, CommandClaim, ConsumeTokenRequest, PickOutcome,
  ReferenceInsert, SubmitOutcome, TokenSpan,
} from '@xrkseek/client-ui-input-trigger/client'
/** Re-exported claim shape: the machine's frozen in-flight slot holds one. */
export type { CommandClaim } from '@xrkseek/client-ui-input-trigger/client'
import type { QueueRow } from '../contract/queue.ts'
import type { InputSubmitMode } from '../contract/composer-submission.ts'

/** Browser-runtime identity of one unsent image draft. */
export type DraftAttachmentId = Branded<'DraftAttachmentId'>

/**
 * The scoped-event application verbs: the hub's bail listeners call these,
 * and the boolean answer IS the event's bail value (true ⟺ the editor
 * applied the edit after phase and span guards).
 */
export interface InputTarget {
  /** Replace the trigger span with claim.token and enter claimed (span-CAS'd). */
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean
  /** Replace the trigger span with one reference chip (span-CAS'd). */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
}

/** Per-session input facade owned by the conversation wiring layer. */
export interface SessionInput extends InputTarget {
  /** Replace the whole draft (persisted-draft seed and programmatic writes). */
  setDraft(text: string): void
  /**
   * Return the keyboard to the composer with the caret it last held, for
   * callers that took focus away from it (an overlay that held its own).
   */
  focus(): void
  /** Append ordered browser-owned image ids; busy admission phases refuse. */
  addImages(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned image id; busy admission phases refuse. */
  removeImage(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneImages(ids: readonly DraftAttachmentId[]): void
  /**
   * THE complexity sink: enter adjudication, submit transaction, and the default sink live inside.
   * @param mode - delivery intent retained through asynchronous adjudication and serialization.
   */
  submit(mode?: InputSubmitMode): void
  /**
   * Surface a notice outside the machine's own effect stream: detached
   * command results and business notifications render through here.
   * Session-routed — resolving the facade via SessionInputResolver.for(actx) lands
   * the notice on that session's composer, so a result arriving after a
   * session switch still reaches its own session.
   * @param level - severity tier.
   * @param text - notice body.
   */
  notify(level: 'info' | 'error', text: string): void
  /** Input state store (InputZone currency). */
  readonly state: SnapshotStore<InputState>
}

/** Session-addressed access to the per-session input facade. */
export interface SessionInputResolver {
  /** Resolve the facade for one session-scope ctx. */
  for(actx: ClientContext): SessionInput
}

/**
 * The public input action face provided to every session-scope slot
 * component: stable-identity void callbacks, mirroring the
 * useStore+actions convention. Command-style handles (arbitrate/space/
 * paste/…) stay InputBar-private and never ride this face.
 */
export interface InputActions {
  /** Replace the whole draft (persisted-draft seed and programmatic writes). */
  setDraft(text: string): void
  /** Append ordered browser-owned image ids; busy admission phases refuse. */
  addImages(ids: readonly DraftAttachmentId[]): boolean
  /** Remove one browser-owned image id; busy admission phases refuse. */
  removeImage(id: DraftAttachmentId): void
  /** Drop ids whose browser-owned objects no longer exist. */
  pruneImages(ids: readonly DraftAttachmentId[]): void
  /** Enter submission (adjudication / claim transaction / default sink inside). */
  submit(): void
}

/** One surfaced notice (command results, adjudication failures). seq keys re-render of repeats. */
export interface InputNotice {
  readonly level: 'info' | 'error'
  readonly text: string
  readonly seq: number
}

/**
 * The InputBar-exclusive keyboard/DOM command face: synchronous
 * returns and event-handler semantics that must not enter the public provide
 * channel. Handed to the composer-bar entry through its own inject —
 * package-internal, never across a plugin boundary. The session shell
 * satisfies it structurally. Text editing itself rides the shell's Lexical
 * editor (exposed here for the contenteditable binding); the members below
 * are the submit-plane and trigger-pipeline verbs the editor does not own.
 */
export interface ComposerKeyboard {
  /** Live machine state for event-handler reads (render reads go through useInput). */
  readonly snapshot: InputState
  /** The shell-owned Lexical editor the composer binds its contenteditable to. */
  readonly editor: LexicalEditor
  /** Submit with an explicit delivery mode resolved by the submission policy. */
  submit(mode: InputSubmitMode): void
  /**
   * Steer every still-pending queued message into the running turn (the
   * empty-draft accelerated-Enter gesture; the queue dock's per-row steer
   * button is the same operation applied to the whole queue).
   */
  steerQueue(): void
  /** Insert pasted plain text over the current editor selection (reference-placeholder-sanitized). */
  paste(text: string): void
  /**
   * The live selection as a detect-coordinate span (menu-launcher synthetic
   * hits replace it on pick); an absent selection answers a collapsed span at
   * the document end.
   */
  caretSpan(): EditSelection
  /** Keyboard arbitration while the menu is open ('pass' when no pipeline). */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** Space adjudication; true = the input applied a claim — caller preventDefaults. */
  space(): boolean
  /** Dismiss the popupSelect shell (any interaction outside the box). */
  dismissPopup(): void
  /**
   * Bind the mounted composer's file action and live intake availability.
   * @param picker - availability query and native file-dialog opener.
   * @returns the unbind disposer.
   */
  bindFilePicker(picker: { available(): boolean; open(): void }): () => void
}

/** One independently addressable row projected from the transient queue snapshot. */
export type QueuedMessage = QueueRow

/** Guard union of the scoped consume-token event, checked by the shell. */
export type ConsumeTokenGuard = ConsumeTokenRequest['guard']

/** Half-open [start, end) range/selection in detect-projection coordinates. */
export interface EditSelection {
  readonly start: number
  readonly end: number
}

/**
 * One reference occurrence projected from the editor's chip nodes, in
 * clipboard-text coordinates. Identity is occurrenceId — a stable per-shell
 * assignment per chip NodeKey, so same-named references stay independently
 * addressable and survive undo. label/appearance/clipboardText are the
 * owner's insert-time projections cached on the node (invalid flips instead
 * of dropping the occurrence).
 */
export interface Occurrence {
  /** Shell-assigned stable identity (monotonic per shell, keyed by NodeKey). */
  readonly occurrenceId: number
  /** Owning source name (serializer routing key). */
  readonly source: string
  /** Owner-scoped reference id. */
  readonly ref: string
  /** Offset in the clipboard-text projection. */
  readonly offset: number
  /** Length in the clipboard-text projection; the occurrence occupies exactly [offset, offset+length). */
  readonly length: number
  /** Inline display label (insert-time cache). */
  readonly label: string
  /** Optional domain glyph (insert-time cache). */
  readonly appearance?: ReferenceInsert['appearance']
  /** Clipboard / persistence projection, e.g. `/name` (insert-time cache, never the model form). */
  readonly clipboardText: string
  /** Owner-resolution failure flag: the chip renders the failure treatment. */
  readonly invalid?: boolean
}

/** Published input state (the currency; per-session). */
export interface InputState {
  /** Clipboard-text projection of the editor document (chips expanded to their clipboard form). */
  readonly draft: string
  /** Ordered runtime-only image ids; bytes and URLs stay in ConversationController. */
  readonly imageIds: readonly DraftAttachmentId[]
  /** Monotonic editor revision (span CAS compares against this). */
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  /** Present exactly while claimed/submitting (claim snapshot during flight; submit closure withheld). */
  readonly claim?: { readonly token: string; readonly hint?: string; readonly images?: boolean }
  /** Reference occurrence view of the editor's chips, sorted by offset. */
  readonly occurrences: readonly Occurrence[]
  /** Read-only transient inbox projection (`session/queue`, including pending steering). */
  readonly queue: readonly QueuedMessage[]
}

/**
 * One in-flight submission attempt: the ONLY id concept in the submit plane.
 * Created on enter; carried by adjudicated/submit-settled/sink-settled
 * events; stale attempts are dropped (anti-backwash). Command attempts hold
 * the single frozen in-flight slot; default-sink attempts run detached and
 * concurrently. release/session teardown aborts them all, keeping every
 * promise bounded.
 */
export interface SubmitAttempt {
  readonly seq: number
  readonly signal: AbortSignal
  /** Clipboard-projection draft captured before an optimistic default-send commit. */
  readonly draftSnapshot: string
  /** Default-message delivery intent retained while slash adjudication is pending. */
  readonly mode: InputSubmitMode
}

/**
 * Submit-machine input events (the machine's single write path). Text
 * mutation lives in the editor; the machine only observes the draft through
 * event payloads (claim integrity, enter snapshots, settlement decisions).
 */
export type InputEvent =
  /** Clipboard projection changed: the claimed integrity watch runs (zero effects). */
  | { readonly type: 'draft-changed'; readonly draft: string }
  /** The editor applied a claim-token replacement: enter claimed. */
  | { readonly type: 'claim'; readonly claim: CommandClaim }
  /** Enter submission with the current clipboard projection. */
  | { readonly type: 'enter'; readonly mode: InputSubmitMode; readonly draft: string }
  | { readonly type: 'adjudicated'; readonly attempt: SubmitAttempt; readonly outcome: PickOutcome }
  | { readonly type: 'adjudication-failed'; readonly attempt: SubmitAttempt; readonly message: string }
  /** Settlement carries the live clipboard projection for suffix-retention and claim re-entry decisions. */
  | { readonly type: 'submit-settled'; readonly attempt: SubmitAttempt; readonly ok: boolean; readonly draft: string; readonly outcome?: SubmitOutcome; readonly message?: string }
  /** Settlement of one optimistic default send, independent of the frozen command slot. */
  | { readonly type: 'sink-settled'; readonly attempt: SubmitAttempt; readonly ok: boolean; readonly outcome?: SubmitOutcome; readonly message?: string }
  /** Commit an image-only send whose empty draft did not need an attempt. */
  | { readonly type: 'send-committed' }
  | { readonly type: 'release' }

/**
 * Submit-machine output effects (executed by the SessionInput shell; the
 * machine stays pure).
 */
export type InputEffect =
  | { readonly type: 'adjudicate'; readonly attempt: SubmitAttempt; readonly draft: string }
  | { readonly type: 'begin-submit'; readonly attempt: SubmitAttempt; readonly claim: CommandClaim; readonly args: string }
  /** Detached default send; the shell captures its editor projection before the following commit effect. */
  | {
    readonly type: 'default-sink'
    readonly attempt: SubmitAttempt
    readonly draft: string
    readonly mode: InputSubmitMode
  }
  | { readonly type: 'notice'; readonly level: 'info' | 'error'; readonly text: string }
  /**
   * Clear the committed draft in the editor and cut undo history. A string
   * snapshot keeps a pure suffix typed during the Host round-trip (content
   * appended after the sent snapshot survives; interleaved edits cannot be
   * separated and clear whole); null clears unconditionally (image-only
   * sends have no draft to retain).
   */
  | { readonly type: 'commit-draft'; readonly retainSuffixOf: string | null }
