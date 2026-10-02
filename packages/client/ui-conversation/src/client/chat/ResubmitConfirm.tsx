/**
 * Cursor-style confirm when resubmitting from a past user message:
 * Cancel / Don't revert workspace / Revert workspace + truncate lineage.
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
  readonly busy?: boolean
  readonly onChoice: (choice: ResubmitConfirmChoice) => void
}

/** Three-way confirm for edit-resubmit / delete of a past transcript message. */
export function ResubmitConfirm({
  open,
  title,
  description,
  cancelLabel,
  keepFilesLabel,
  revertFilesLabel,
  busy = false,
  onChoice,
}: ResubmitConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onChoice('cancel') }}
      title={title}
      className={css.dialog ?? ''}
      contentClassName={css.body ?? ''}
      footer={(
        <>
          <Button
            variant="outline"
            className={css.action}
            disabled={busy}
            onClick={() => { onChoice('cancel') }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="outline"
            className={css.action}
            disabled={busy}
            onClick={() => { onChoice('keep-files') }}
          >
            {keepFilesLabel}
          </Button>
          <Button
            variant="primary"
            className={css.action}
            disabled={busy}
            onClick={() => { onChoice('revert-files') }}
          >
            {revertFilesLabel}
          </Button>
        </>
      )}
    >
      <p className={css.description}>{description}</p>
    </Modal>
  )
}
