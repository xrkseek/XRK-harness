/** The default composer body: the 'conversation.composer.bar' slot entry.
 * Machine state arrives through the standard provide channel
 * (useInput + inputActions); the keyboard/DOM command face and stop arrive
 * through this entry's own inject, whose hooks compartment binds
 * useNotices/useLexicon; layout-phase inputs (variant, placeholder,
 * region-slot content) ride the owner props. Session facts
 * (running/removed/promptError) are self-selected via useSession.
 *
 * The text surface is the shell-owned Lexical editor bound here through
 * ComposerContentEditable; chips render as decorator portals, and the
 * keymap registers submit/menu/paste gestures on the editor command layer.
 * The no-session state renders the SAME div inert as the Workspace-picker
 * trigger instead of a parallel tree.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconPlusOutline16, IconWarningOutline16, Toast, Tooltip,
} from '@xrkseek/client-ui-primitives'
// Type-only: the `plan` projection key merge (the TodoDock posture — the
// composer reads a host-computed value; the domain owns the key).
import type {} from '@xrkseek/xrk-plan-mode/client'
// Type-only: the `goal` projection key merge (hint disambiguation).
import type {} from '@xrkseek/xrk-goal/client'
// The `imageLimits` projection key merge (intake pre-check) arrives with the
// wire types: apiproxy's sessions contract declares it, and client-runtime's
// api-remotes import already places it in every client program.
import type { Translate } from '@xrkseek/client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { InputNotice } from '../input/contract.ts'
import { DraftEditor } from '../input/editor/DraftEditor.tsx'
import {
  focusDraftEditor, installDraftFilePicker, installDraftKeymap, installDraftWheel,
  keepDraftFocus, revealDraftSelection,
} from '../input/editor/view-binding.ts'
import { resolveSubmitMode } from '../input/resolve-submit-mode.ts'
import { attachmentErrorText, imageSizeText } from '../image-labels.ts'
import { ContextMeter } from './ContextMeter.tsx'
import { PermissionSelect } from './PermissionSelect.tsx'
import css from './InputBar.module.css'

export type InputBarProps = ComposerBarProps

function blockHasVisibleContent(block: { kind: string; text?: string }): boolean {
  if (block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') {
    return typeof block.text === 'string' && block.text.trim() !== ''
  }
  return true
}

export const InputBar = memo(function InputBar({
  useSession, useInput, inputActions, keyboard, addImages, removeImage, draftImages, retryFile,
  toggleCommandMenu, stop, command, bindCommandComposerFocus, t,
  renderSlot, useBusyEnter, useNotices, useLexicon, useMenuLauncher, useFileUploads,
  useProjection, useConnectionState, sessionId, variant, disabled: inert = false, blocked,
  workspacePickerOpen = false, onRequestWorkspace,
  placeholder, accessory, overlay, leftItems, rightItems, footer,
}: InputBarProps) {
  const input = useInput(s => s)
  const notice = useNotices(s => s)
  const busyEnter = useBusyEnter(s => s)
  void useLexicon // hook seat stays bound by the inject compartment; text-ref decoration rides the shell's editor transforms
  const fileUploads = useFileUploads(s => s)
  const commandMenuOpen = useMenuLauncher(source => source === 'command')
  const promptError = useSession(s => s.promptError) ?? null
  const running = useSession(s => s.running) ?? false
  const partial = useSession(s => s.partial) ?? null
  const runningCallCount = useSession(s => s.runningCalls.length) ?? 0
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  const reconnecting = useConnectionState(state => state === 'reconnecting')
  // Plan mode swaps the composer placeholder (the projection is the folded
  // host value; owner-prop placeholders — hero, session-unavailable — win).
  const planActive = useProjection('plan', plan => plan !== undefined && (plan.pending ? !plan.active : plan.active))
  // Absent (undefined: no frame yet) and cleared (null) both mean no goal.
  const hasGoal = useProjection('goal', goal => goal != null)
  // Session-maybe: the machine faces are absent together while no session is
  // current; the bar renders the same DOM inert instead of a parallel tree.
  const live = input !== undefined && keyboard !== undefined && inputActions !== undefined
  const draft = input?.draft ?? ''
  const editor = keyboard?.editor ?? null
  const attachments = useMemo(
    () => input === undefined || draftImages === undefined ? [] : draftImages(input.imageIds),
    [draftImages, input?.imageIds],
  )
  const empty = draft.trim() === '' && attachments.length === 0
  const filesNotReady = attachments.some((attachment) => {
    if (attachment.kind !== 'file') return false
    const upload = fileUploads?.[attachment.id]
    return upload === undefined || upload.status !== 'ready'
  })
  // Keep Send↔Stop aligned with an open turn tail: optimistic cancel clears
  // `running` before partial/tool rows settle (DSH drain-latch posture).
  const agentActive = running
    || runningCallCount > 0
    || (partial !== null && partial.blocks.some(blockHasVisibleContent))
  // Transient error banner (machine notices, image-intake rejections, and
  // prompt failures): the seq keys the Toast so an identical repeated message
  // restarts the hold-then-fade cycle instead of reusing the faded one.
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  // The deployment's image-intake limits (absent while no attachment service
  // is composed — the pre-check below then defers entirely to the host).
  const imageLimits = useProjection('imageLimits')
  const fileLimits = useProjection('fileLimits')
  // Prompt failures are ordinary failures (no create/attach transaction exists
  // anymore): the toast announces promptError, the draft stays in the machine,
  // and the user resubmits. A remount over a session whose machine still holds
  // an unresolved promptError deliberately re-announces it once — the failure
  // is still pending, and a transient banner is its only surface. Attachment
  // rejections show product copy keyed by the wire reason; other codes are
  // developer-facing and keep the raw message plus code.
  useEffect(() => {
    if (promptError === null) return
    showToast(promptError.error.code === 'attachment-error'
      ? attachmentErrorText(t, promptError.error.details.reason, imageLimits)
      : `${promptError.error.message} (${promptError.error.code})`)
  }, [promptError, showToast, t, imageLimits])
  // An error notice is one-shot admission feedback, not pending state (unlike
  // promptError above, which really is unresolved until the next submit). The
  // shell's notice store outlives the bar, so a remount over a session whose
  // machine still holds the last failure, and a switch into such a session,
  // must adopt the held notice silently instead of re-announcing it.
  const surfacedNotice = useRef<InputNotice | null>(notice)
  const surfacedSession = useRef(sessionId)
  useEffect(() => {
    const changed = surfacedNotice.current !== notice
    const switched = surfacedSession.current !== sessionId
    surfacedNotice.current = notice
    surfacedSession.current = sessionId
    if (!changed || switched || notice === null) return
    if (notice.level === 'error') showToast(notice.text)
  }, [notice, sessionId, showToast])
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The Access seat's data: the host-computed permissions projection
  // (undefined = capability absent → the chip renders nothing).
  const permissions = useProjection('permissions')

  // A continuable child without its live parent cannot accept human input,
  // but its independent Stop below stays available while it runs.
  const continuable = subagent?.address.mode === 'continuable'
  const parentOffline = continuable && !subagent.parentAvailable
  // Running input stays free; locked = session removed, the
  // inert no-workspace state, the machine faces absent (no session),
  // reconnecting wire, or a parent-offline continuable child. An owner block
  // also disables input; adjudicating and submitting render read-only so the
  // draft stays visible.
  const disabled = removed || inert || !live || blocked !== undefined || parentOffline || reconnecting
  const locked = disabled
  // The model seat is the ONE control a block leaves live: every block this
  // contract has is cleared by choosing a model, so locking it too would leave
  // the composer asking for the only thing it prevents. The other reasons to
  // be disabled do lock it — there is no session to choose a model for.
  const modelSeatLocked = removed || inert || !live || reconnecting
  const machineBusy = input?.phase === 'adjudicating' || input?.phase === 'submitting'
  // The no-workspace surface remains the resident DOM node but acts as the
  // existing picker trigger. Message controls stay locked until a Session
  // exists; the trigger itself is read-only rather than disabled so pointer
  // and keyboard users can reach the recovery action.
  const workspaceTrigger = inert && !removed && onRequestWorkspace !== undefined
  const editorDisabled = removed || (locked && !workspaceTrigger)
  const editable = live && !locked && !machineBusy
  // Steer / busy-Enter follow Host `running` (open next-step window), not the
  // drain latch: after cancel, partial/tool tails keep Stop via `agentActive`
  // but must not advertise chords the Host will reject as steer-unavailable.
  // Continuable children share busy-Enter Queue/Steer and whole-queue flush;
  // one-shot stays Queue-only and never exposes interrupt chrome.
  const steeringAvailable = subagent === null || subagent.address.mode === 'continuable'
  const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && steeringAvailable
    && (input?.queue.some(row => row.placement === 'queued') ?? false)
  // Chord hints only when a non-empty draft can actually submit — empty Enter
  // is a no-op; whole-queue flush is Cmd/Ctrl+Enter only.
  const busyEnterHint = running && steeringAvailable && !canSteerQueue && !disabled && !empty
    ? resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)
    : null

  useEffect(() => {
    if (input === undefined || inputActions === undefined) return
    if (attachments.length !== input.imageIds.length) {
      inputActions.pruneImages(attachments.map(attachment => attachment.id))
    }
  }, [attachments, input?.imageIds, inputActions])

  // Scroll the draft scrollport the minimum that brings the selection focus
  // into view — the browser's own behavior for typing, performed for the
  // paths where it does not act (programmatic focus with preventScroll, and
  // session switches that land the caret off screen). The live DOM selection
  // is the ruler; no mirror layer exists to consult.
  const revealSelection = (): void => {
    revealDraftSelection(scrollRef)
  }

  // Unlock (mount / session switch) returns focus to the box, and owns the
  // reveal that comes with it. Lexical's focus() suppresses the browser's
  // scroll walk (preventScroll inside), so the reveal in our own scrollport
  // is ours to perform — switching to a longer draft otherwise leaves the
  // caret (restored at the draft's end) off screen.
  useEffect(() => {
    if (locked || editor === null) return
    focusDraftEditor(editor, revealSelection)
  }, [locked, sessionId, editor])

  // External draft writers (sidebar `@` mention) call SessionInput.focus(); the
  // bar owns the editor binding, so it registers the DOM implementation on
  // commandUi's composer-focus hook (popup Escape path) to the same target.
  useEffect(() => {
    if (editor === null || bindCommandComposerFocus === undefined) return
    const focusDom = (): void => {
      if (locked) return
      focusDraftEditor(editor, revealSelection)
    }
    return bindCommandComposerFocus(focusDom)
  }, [bindCommandComposerFocus, editor, locked, sessionId])

  // A persisted draft arrives AFTER the unlock effect: ConversationSession
  // adopts it in its own mount effect, and a parent's mount effect runs after
  // its children's. Reveal when the draft becomes non-empty so a restored long
  // draft does not stay at its head with the caret at its end. This effect does
  // not focus: send-clear, failed-send restore, and first-character transitions
  // must not steal focus from another control the user moved to.
  useEffect(() => {
    if (locked || draft === '') return
    revealSelection()
  }, [draft !== ''])

  // Wheel chaining on the draft scrollport, one lifetime (it is never
  // unmounted — the inert state renders the same element disabled). While the
  // capped box can still move in this direction, keep the native scroll; only
  // at its own edge forward the delta to the active conversation scrollport, so
  // a short draft never traps the gesture and a long draft stays scrollable.
  // Hero mounts have no host and keep native wheel scrolling.
  useEffect(() => {
    return installDraftWheel(scrollRef)
  }, [])

  // Intake pre-check (DeepSeek Chat semantics): an addition that would break
  // a projected limit is refused as a whole batch, announced immediately, and
  // never enters the rail — no more submit-time failure rolling the rail
  // back. The host enforces the same limits at submit for callers that bypass
  // this composer. Subagent sessions reject attachments at intake (not only at RPC).
  const intakeImages = useCallback((files: readonly File[]): void => {
    if (addImages === undefined || files.length === 0) return
    if (subagent !== null) {
      showToast(t('image.subagentUnsupported'))
      return
    }
    const rejected = ((): string | null => {
      const imageTypes = imageLimits?.mediaTypes as readonly string[] | undefined
      const imageFiles = imageTypes === undefined
        ? []
        : files.filter(file => imageTypes.includes(file.type))
      const otherFiles = imageTypes === undefined
        ? [...files]
        : files.filter(file => !imageTypes.includes(file.type))

      if (otherFiles.length > 0 && fileLimits === undefined) {
        // No fileLimits projection: shell only accepts image MIME types.
        return t('image.unsupportedType')
      }

      if (imageLimits !== undefined && imageFiles.length > 0) {
        const existingImages = attachments.filter(attachment => attachment.kind === 'image')
        if (existingImages.length + imageFiles.length > imageLimits.maxImagesPerMessage) {
          return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
        }
        if (imageFiles.some(file => file.size > imageLimits.maxImageBytes)) {
          return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
        }
        const total = existingImages.reduce((sum, attachment) => sum + attachment.file.size, 0)
          + imageFiles.reduce((sum, file) => sum + file.size, 0)
        if (total > imageLimits.maxMessageImageBytes) {
          return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
        }
      }

      if (fileLimits !== undefined && otherFiles.length > 0) {
        const existingFiles = attachments.filter(attachment => attachment.kind === 'file')
        if (existingFiles.length + otherFiles.length > fileLimits.maxFilesPerMessage) {
          return t('file.tooMany', { count: fileLimits.maxFilesPerMessage })
        }
        if (otherFiles.some(file => file.size > fileLimits.maxFileBytes)) {
          return t('file.fileTooLarge', { size: imageSizeText(fileLimits.maxFileBytes) })
        }
        const total = existingFiles.reduce((sum, attachment) => sum + attachment.file.size, 0)
          + otherFiles.reduce((sum, file) => sum + file.size, 0)
        if (total > fileLimits.maxMessageFileBytes) {
          return t('file.totalTooLarge', { size: imageSizeText(fileLimits.maxMessageFileBytes) })
        }
      }

      return addImages(files)
    })()
    if (rejected !== null) showToast(rejected)
  }, [addImages, attachments, fileLimits, imageLimits, showToast, subagent, t])

  const canAcceptDrop = !locked && !machineBusy && addImages !== undefined && subagent === null

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onPickFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files === null ? [] : [...e.target.files]
    // Reset so picking the same file again re-fires the change event.
    e.target.value = ''
    if (picked.length > 0) intakeImages(picked)
  }

  // The keymap handlers read live bar state through this ref so the editor
  // registration survives re-renders without re-arming per keystroke.
  const gate = useRef({
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles: intakeImages, uploadsPending: filesNotReady, showToast, t, canAcceptDrop,
  })
  gate.current = {
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles: intakeImages, uploadsPending: filesNotReady, showToast, t, canAcceptDrop,
  }

  useEffect(() => {
    if (keyboard === undefined) return
    return installDraftFilePicker(keyboard, gate, fileInputRef)
  }, [keyboard])

  useEffect(() => {
    if (editor === null || keyboard === undefined) return
    return installDraftKeymap(editor, keyboard, gate)
  }, [editor, keyboard])

  // Button presses steal focus from the editor; suppress at mousedown so
  // typing continues seamlessly. Lexical's focus() carries preventScroll and
  // restores the previous selection, so no reveal is needed: the caret has
  // not moved, and the next keystroke gets the browser's native one.
  const keepFocus = (e: MouseEvent<HTMLButtonElement>): void => {
    keepDraftFocus(e, editor)
  }

  const onToggleCommandMenu = (): void => {
    if (keyboard === undefined) return
    // The menu is a combobox over the editor, so the keyboard has to be there
    // before the launcher opens it: activating the button from the keyboard
    // leaves focus on the button, and restoring it afterwards would re-track an
    // empty draft and close the menu again.
    if (editor !== null) focusDraftEditor(editor, revealSelection)
    toggleCommandMenu?.(keyboard.caretSpan())
  }

  // The no-session Workspace trigger: the resident editable div acts as the
  // picker trigger for keyboard users (no editor is bound in this state).
  const onWorkspaceKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!workspaceTrigger) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRequestWorkspace()
    }
  }

  // An ordinary running session keeps Stop while the composer is empty or
  // owner-blocked; an actionable draft gets the busy Send action, delivered
  // through the same mode plain Enter resolves to. The label names that mode
  // only when the click would deliver a plain message right now — an enabled
  // button (no pending upload) over a non-empty draft that is neither a
  // claimed command nor a `/` line headed for adjudication — so it never
  // describes a delivery the click cannot or does not perform; every other
  // state keeps plain Send. `agentActive` covers the post-cancel window where
  // `running` cleared but the streaming tail has not settled yet. Any
  // addressed child keeps Send primary and exposes Stop independently —
  // including a one-shot child, which otherwise offers no way out while it
  // hangs in a tool (it cannot accept messages, but it can be cancelled, and
  // the host cascades that cancel to the child's own children).
  const primaryStops = agentActive && subagent === null && (empty || blocked !== undefined)
  const interruptible = agentActive && subagent !== null
  const primarySubmitMode = resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)
  const plainMessageDraft = !empty && input?.phase === 'plain' && !draft.trimStart().startsWith('/')
  const primaryLabel = primaryStops
    ? t('input.stop')
    : running && steeringAvailable && !disabled && !filesNotReady && plainMessageDraft
      ? t(primarySubmitMode === 'steer' ? 'input.send.steer' : 'input.send.queue')
      : t('input.send')
  const primaryHint = primaryStops
    ? t('input.stop')
    : running && steeringAvailable && !disabled && !filesNotReady && plainMessageDraft
      ? t(primarySubmitMode === 'steer' ? 'input.send.steer.hint' : 'input.send.queue.hint')
      : t('input.send')
  const onPrimary = (): void => {
    if (primaryStops) {
      stop?.()
      return
    }
    if (keyboard === undefined) return // absent machine: the button is disabled
    /* v8 ignore next -- defensive: the primary button is disabled for empty, disabled, and pending-upload states. */
    if (!empty && !disabled && !machineBusy && !filesNotReady) keyboard.submit(primarySubmitMode)
  }

  // The Access seat: the projection-fed permission chip (renders nothing
  // while the permissions key is absent — permission-less host or Draft —
  // or while the command face is absent with the session).
  const accessSelect: ReactNode = command === undefined
    ? null
    : <PermissionSelect key={sessionId} value={permissions} locked={locked} command={command} t={t} />

  // Claim ghost hint: rendered by CSS as generated content after the last
  // paragraph while the claim's args are blank (a hint implies a single-line
  // token draft). The translated per-command hint wins over the claim's own.
  const claimActive = (input?.phase === 'claimed' || input?.phase === 'submitting')
    && input.claim !== undefined && draft.startsWith(input.claim.token)
  const rawHint = claimActive && input.claim.hint !== undefined
    && draft.slice(input.claim.token.length).trim() === ''
    ? input.claim.hint
    : null
  const hint = ((): string | null => {
    if (rawHint === null) return null
    const commandName = input?.claim?.token.slice(1).trim() ?? ''
    const hintKey = `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}`
    // Dynamic lookup by claimed command name: unknown commands miss the
    // dictionary and keep the machine's own hint, so the call is wide.
    const translated = (t as Translate)(hintKey)
    return translated !== hintKey ? translated : rawHint
  })()

  const placeholderText = placeholder ?? (reconnecting
    ? t('placeholder.reconnecting')
    : parentOffline
      ? t('placeholder.parentOffline')
      : disabled
        ? t('placeholder.unavailable')
        // The steer hint deliberately outranks the plan placeholder:
        // while it shows, the whole-queue gesture is genuinely available
        // (the gate never consults plan mode), so the actionable hint wins.
        : canSteerQueue
          ? t('placeholder.steerQueue')
          : busyEnterHint === 'queue'
            ? t('placeholder.busyQueue')
            : busyEnterHint === 'steer'
              ? t('placeholder.busySteer')
              : planActive ? t('placeholder.plan') : t('placeholder.default'))

  return (
    <div className={clsx(css.root, variant === 'hero' && css.hero)}>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={cardRef.current}
          onDone={dismissToast}
        />
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status">
          {notice.text}
        </div>
      )}
      {/* Trigger clicks land on the card, not the editor: the toolbar row's
          disabled controls swallow clicks otherwise (the CSS state disarms
          their pointer events), so the WHOLE capsule is the pick target.
          pointerdown stops here so the Menu's outside-close cannot race the
          click's reopen (close-then-open flickers the chip's open echo). */}
      <div
        ref={cardRef}
        className={clsx(css.card, workspaceTrigger && css.cardWorkspaceTrigger)}
        data-composer-card
        onClick={workspaceTrigger ? onRequestWorkspace : undefined}
        onPointerDown={workspaceTrigger ? (e) => { e.stopPropagation() } : undefined}
      >
        {overlay !== undefined && <div className={css.overlayAnchor}>{overlay}</div>}
        {accessory !== undefined && <div className={css.accessory}>{accessory}</div>}
        {renderSlot('conversation.input.attachments', {
          attachments,
          canAcceptDrop,
          onAddImages: intakeImages,
          onRemoveImage: (id) => { removeImage?.(id) },
          uploads: fileUploads ?? {},
          onRetryFile: (id) => { retryFile?.(id) },
          dropLimits: imageLimits === undefined && fileLimits === undefined
            ? undefined
            : {
              count: Math.max(
                imageLimits?.maxImagesPerMessage ?? 0,
                fileLimits?.maxFilesPerMessage ?? 0,
              ),
              size: imageSizeText(Math.max(
                imageLimits?.maxImageBytes ?? 0,
                fileLimits?.maxFileBytes ?? 0,
              )),
            },
        })}
        {/* One scrollport, one text surface: the contenteditable grows with
            its content and .scroll — capped at 14 lines in CSS — is the only
            thing that scrolls. Chips are decorator portals inside the same
            surface, so wrapping, caret geometry, and scrolling are the
            browser's own. */}
        <DraftEditor
          classNames={css}
          editor={editor}
          scrollRef={scrollRef}
          editable={editable}
          editorDisabled={editorDisabled}
          phase={input?.phase ?? 'inert'}
          placeholderText={placeholderText}
          ariaLabel={workspaceTrigger ? t('hero.chooseWorkspace') : placeholderText}
          workspaceTrigger={workspaceTrigger}
          workspacePickerOpen={workspacePickerOpen}
          onWorkspaceKeyDown={onWorkspaceKeyDown}
          hint={hint}
          showPlaceholder={draft === '' && attachments.length === 0 && !claimActive}
        />
        <div className={css.row}>
          <div className={css.tools}>
            <Tooltip label={t('input.commands')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.add}
                aria-label={t('input.commands')}
                aria-haspopup="listbox"
                aria-expanded={commandMenuOpen}
                disabled={locked || toggleCommandMenu === undefined}
                onMouseDown={keepFocus}
                onClick={onToggleCommandMenu}
              >
                <IconPlusOutline16 size={14} />
              </button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={subagent !== null}
              hidden
              onChange={onPickFiles}
            />
            <div className={css.modes}>
              {accessSelect}
              {renderSlot('conversation.input.plan', { locked })}
            </div>
            {leftItems}
          </div>
          <div className={css.trailing}>
            {rightItems}
            {renderSlot('conversation.input.model', { locked: modelSeatLocked })}
            <ContextMeter useProjection={useProjection} t={t} />
            {interruptible && (
              <Tooltip label={t('input.stop')} side="top" delayMs={500}>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={t('input.stop')}
                  disabled={stop === undefined}
                  onMouseDown={keepFocus}
                  onClick={stop}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>
            )}
            <Tooltip label={primaryHint} side="top" delayMs={500}>
              <button
                type="button"
                className={css.primary}
                aria-label={primaryLabel}
                disabled={primaryStops ? stop === undefined : empty || disabled || machineBusy || filesNotReady}
                onMouseDown={keepFocus}
                onClick={onPrimary}
              >
                {primaryStops ? (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      {footer}
    </div>
  )
})
