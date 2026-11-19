/**
 * Cursor-style confirm when resubmitting from a past user message:
 * Cancel / Don't revert workspace / Revert workspace + truncate lineage.
 *
 * The safe choice carries the primary weight: truncating the transcript is
 * already irreversible, and dropping the workspace to the pre-message state on
 * top of it is the riskiest click in the dialog. Reverting files stays one
 * outline button away, never the default-looking action.
 */
import { Button, Modal } from '@xrkseek/client-ui-primitives'
import css from './ResubmitConfirm.module.css'

export type ResubmitConfirmChoice = 'cancel' | 'keep-files' | 'revert-files'

export interface ResubmitConfirmProps {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly cancelLabel: string
  readonly keepFilesLabel: string
  readonly revertFilesLabel: string
  /** X button aria-label; defaults to English Modal fallback without this. */
  readonly closeLabel: string
  /**
   * `three-way` = cancel / keep files / revert files (edit·delete·regenerate).
   * `confirm` = cancel / primary (restore workspace) — primary resolves as keep-files.
   */
  readonly mode?: 'three-way' | 'confirm'
  readonly busy?: boolean
  readonly onChoice: (choice: ResubmitConfirmChoice) => void
}

/** Confirm for edit-resubmit / delete / regenerate / restore-workspace. */
export function ResubmitConfirm({
  open,
  title,
  description,
  cancelLabel,
  keepFilesLabel,
  revertFilesLabel,
  closeLabel,
  mode = 'three-way',
  busy = false,
  onChoice,
}: ResubmitConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onChoice('cancel') }}
      title={title}
      closeLabel={closeLabel}
      layout="inset"
      className={css.dialog ?? ''}
      contentClassName={css.body ?? ''}
      footer={(
        <div className={css.actions}>
          <Button
            variant="outline"
            className={css.action}
            disabled={busy}
            onClick={() => { onChoice('cancel') }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            className={css.action}
            disabled={busy}
            onClick={() => { onChoice('keep-files') }}
          >
            {keepFilesLabel}
          </Button>
          {mode === 'three-way' ? (
            <Button
              variant="outline"
              className={css.action}
              disabled={busy}
              onClick={() => { onChoice('revert-files') }}
            >
              {revertFilesLabel}
            </Button>
          ) : null}
        </div>
      )}
    >
      <p className={css.description}>{description}</p>
    </Modal>
  )
}
