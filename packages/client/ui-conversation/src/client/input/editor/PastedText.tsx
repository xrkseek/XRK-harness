/**
 * Visual body of one folded paste: the PastedTextNode's React face.
 *
 * Paints a single truncated line naming the size, with expand (inline the
 * body) and delete (drop the whole fold) gestures. Pure display — the node
 * owns identity and the node surgery; this component owns only the chrome.
 */
import type { ReactNode } from 'react'
import { IconChevronDownOutline14, IconTrashOutline16 } from '@xrkseek/client-ui-primitives'
import css from './PastedText.module.css'
import referenceCss from './composer-editor.module.css'

/** Display inputs of one folded paste. */
export interface PastedTextProps {
  /** Line count shown in the summary label. */
  readonly lines: number
  /** Character count shown in the summary label. */
  readonly chars: number
  /** Inline the full body into the draft (the node leaves the document). */
  readonly onExpand: () => void
  /** Drop the fold and its body from the draft. */
  readonly onDelete: () => void
}

/**
 * Render one folded paste as a one-line summary with two gestures.
 * @param props - line/char counts and the expand and delete callbacks.
 * @returns the summary line.
 */
export function PastedText({ lines, chars, onExpand, onDelete }: PastedTextProps): ReactNode {
  return (
    <span className={referenceCss.reference}>
      <span className={css.summary} data-composer-pasted-summary="">
        <span className={css.label}>{`已粘贴文本 · ${lines} 行 · ${chars} 字符`}</span>
      </span>
      <button
        type="button"
        className={referenceCss.openable}
        aria-label="展开粘贴内容"
        onClick={() => { onExpand() }}
      >
        <IconChevronDownOutline14 />
      </button>
      <button
        type="button"
        className={referenceCss.openable}
        aria-label="删除粘贴内容"
        onClick={() => { onDelete() }}
      >
        <IconTrashOutline16 />
      </button>
    </span>
  )
}