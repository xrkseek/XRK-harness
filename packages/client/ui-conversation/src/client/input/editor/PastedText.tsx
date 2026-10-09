/**
 * Visual body of one folded paste: the PastedTextNode's React face.
 *
 * Paints the folded block as a single resting-height row: a size summary, a
 * one-line preview of what was actually pasted, and two gestures. Pure
 * display — the node owns identity and the node surgery; this component owns
 * only the chrome.
 *
 * Deliberately NOT a disclosure. "Expand" here does not reveal content
 * beneath — it re-inlines the body as ordinary editable text, and there is no
 * path back to the fold. The chrome therefore says so (see the action's
 * accessible name and tooltip) instead of borrowing disclosure chevrons that
 * would promise a collapse that does not exist.
 */
import type { ReactNode } from 'react'
import { IconEditOutline16, IconTrashOutline16 } from '@xrkseek/client-ui-primitives'
import css from './PastedText.module.css'

/** Display inputs of one folded paste. */
export interface PastedTextProps {
  /** Line count shown in the summary label. */
  readonly lines: number
  /** Character count shown in the summary label. */
  readonly chars: number
  /**
   * First meaningful line of the body, for the preview. Absent when the paste
   * is blank or whitespace-only, in which case the row shows size alone.
   */
  readonly preview?: string | undefined
  /** Inline the full body into the draft (the node leaves the document). */
  readonly onExpand: () => void
  /** Drop the fold and its body from the draft. */
  readonly onDelete: () => void
}

/** Tooltip and accessible name for the expand gesture. */
const EXPAND_HINT = '插入为可编辑文本（插入后无法再收起）'

/** Tooltip and accessible name for the delete gesture. */
const DELETE_HINT = '移除粘贴内容（Ctrl+Z 可撤销）'

/**
 * Render one folded paste as one row: summary, preview, expand, delete.
 * @param props - counts, the optional preview, and the two callbacks.
 * @returns the folded-paste row.
 */
export function PastedText({ lines, chars, preview, onExpand, onDelete }: PastedTextProps): ReactNode {
  return (
    <span className={css.fold} data-composer-pasted-summary="">
      <span className={css.summary}>
        <span className={css.label}>{`已粘贴 ${lines} 行 · ${chars} 字符`}</span>
        {preview !== undefined && <span className={css.preview}>{preview}</span>}
      </span>
      <button
        type="button"
        className={css.action}
        title={EXPAND_HINT}
        aria-label={EXPAND_HINT}
        onClick={onExpand}
      >
        <IconEditOutline16 />
      </button>
      <button
        type="button"
        className={css.action}
        title={DELETE_HINT}
        aria-label={DELETE_HINT}
        onClick={onDelete}
      >
        <IconTrashOutline16 />
      </button>
    </span>
  )
}
