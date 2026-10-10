/**
 * Visual body of one folded paste: the PastedTextNode's React face.
 *
 * Paints the folded block as a single resting-height row: a size summary, a
 * one-line preview of what was actually pasted, and two gestures.
 *
 * The block is atomic in the draft but NOT read-only. Editing happens in a
 * Modal textarea and is written back through `onSave`, so the body never
 * rejoins contenteditable — the one thing that froze the composer before the
 * fold existed. Editing a paste is "edit off-line, save back", not "the draft
 * becomes a wall of text".
 *
 * Two arms, split by body size:
 * - Within {@link EDIT_MAX_CHARS}: a native textarea, fully editable. Native
 *   text control, so typing in it costs one layout of that control alone.
 * - Beyond it: read-only, head/tail-capped, copyable. Editing a body this
 *   large is the very thing the fold exists to avoid, so the modal says so
 *   instead of offering an edit it cannot make cheap.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconInspectOutline12, IconTrashOutline16, Modal, writeClipboard,
} from '@xrkseek/client-ui-primitives'
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
  /** The full body, seeded into the editor surface. */
  readonly text: string
  /** Adopt an edited body; the node re-folds or inlines it (see replaceText). */
  readonly onSave: (next: string) => void
  /** Drop the fold and its body from the draft. */
  readonly onDelete: () => void
}

/** Tooltip and accessible name for the view/edit gesture. */
const VIEW_HINT = '查看 / 编辑粘贴内容'

/** Tooltip and accessible name for the delete gesture. */
const DELETE_HINT = '移除粘贴内容（Ctrl+Z 可撤销）'

/**
 * Characters above which the surface is read-only rather than editable. A
 * native textarea handles this comfortably; past it, the control's own
 * reflow on every keystroke is the wall-of-text cost moved rather than
 * removed, so the modal reads instead of edits.
 */
const EDIT_MAX_CHARS = 20_000

/**
 * Content lines the read arm shows before the middle collapses. Matches the
 * terminal / read blocks' 16-line default so a long paste cuts at the same
 * place in the same flow.
 *
 * The split arithmetic mirrors `headTailCap` in @xrkseek/client-ui-primitives:
 * `ceil(max / 2)` head rows and the remainder as tail rows. It is inlined
 * rather than imported because that package's public entry is its built
 * `lib/types`, so adding an export there means rebuilding a dependency; four
 * lines are cheaper than that and the constant above keeps them in step.
 */
const READ_MAX_LINES = 16

/** How long the copy button keeps its success label, in ms. */
const COPIED_FEEDBACK_MS = 1000

/**
 * Render one folded paste as one row: summary, preview, view/edit, delete.
 * @param props - counts, the optional preview, the full body, and callbacks.
 * @returns the folded-paste row.
 */
export function PastedText({
  lines, chars, preview, text, onSave, onDelete,
}: PastedTextProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(text)
  const [copied, setCopied] = useState(false)

  // A refused clipboard write leaves the flag untouched, so the button never
  // claims a copy the host declined.
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }, [copied, text])

  const openSurface = useCallback(() => {
    // Re-seed from the node on every open: a previous save may have changed
    // the body, and a cancelled edit must not leak into the next session.
    setDraft(text)
    setExpanded(false)
    setOpen(true)
  }, [text])

  const editable = text.length <= EDIT_MAX_CHARS
  const bodyLines = useMemo(() => draft.split('\n'), [draft])
  const hidden = bodyLines.length - READ_MAX_LINES
  const capped = hidden > 0 && !expanded
  const headLines = Math.ceil(READ_MAX_LINES / 2)
  const tailLines = READ_MAX_LINES - headLines
  const dirty = editable && draft !== text

  return (
    <>
      <span className={css.fold} data-composer-pasted-summary="">
        <span className={css.summary}>
          <span className={css.label}>{`已粘贴 ${lines} 行 · ${chars} 字符`}</span>
          {preview !== undefined && <span className={css.preview}>{preview}</span>}
        </span>
        <button
          type="button"
          className={css.action}
          title={VIEW_HINT}
          aria-label={VIEW_HINT}
          onClick={openSurface}
        >
          <IconInspectOutline12 size={14} />
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
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title="粘贴内容"
        closeLabel="关闭"
        description={editable
          ? '大段粘贴内容不直接进入编辑区：在这里改好保存，草稿里仍是一行折叠块。'
          : `内容超过 ${EDIT_MAX_CHARS} 字符，只读查看；修改请移除后在编辑器里重贴需要改的部分。`}
        className={css.viewDialog ?? ''}
        footer={(
          <>
            <button type="button" className={css.viewGhost} onClick={onCopy}>
              {copied ? '已复制' : '复制全部'}
            </button>
            {editable && (
              <button
                type="button"
                className={css.viewGhost}
                onClick={() => { setOpen(false) }}
              >
                取消
              </button>
            )}
            {editable && (
              <button
                type="button"
                className={css.viewPrimary}
                // Saving a no-op would still mark history; the button only
                // enables on a real edit, so Esc is the way out otherwise.
                disabled={!dirty}
                onClick={() => {
                  onSave(draft)
                  setOpen(false)
                }}
              >
                保存
              </button>
            )}
          </>
        )}
      >
        {editable
          ? (
            <textarea
              className={css.viewArea}
              data-composer-pasted-editor=""
              aria-label="粘贴内容"
              value={draft}
              spellCheck={false}
              onChange={event => { setDraft(event.target.value) }}
            />
          )
          : (
            <div className={css.viewRead} data-composer-pasted-view="">
              <pre className={css.viewBody}>{(capped ? bodyLines.slice(0, headLines) : bodyLines).join('\n')}</pre>
              {hidden > 0 && (
                <p className={css.viewNote}>
                  <button
                    type="button"
                    className={css.viewMore}
                    aria-expanded={expanded}
                    aria-label={expanded ? '收起内容' : `展开其余 ${hidden} 行`}
                    onClick={() => { setExpanded(value => !value) }}
                  >
                    {expanded ? '收起' : `… 其余 ${hidden} 行`}
                  </button>
                </p>
              )}
              {capped && (
                <pre className={css.viewBody}>{bodyLines.slice(bodyLines.length - tailLines).join('\n')}</pre>
              )}
            </div>
          )}
      </Modal>
    </>
  )
}