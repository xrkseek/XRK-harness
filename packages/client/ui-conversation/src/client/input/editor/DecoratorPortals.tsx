/**
 * Decorator render loop: portals every decorator node's React face into its
 * host element (what @lexical/react's composer does internally, scoped to
 * this composer's needs). Chip / folded-paste DOM identity rides the NodeKey —
 * text edits around a decorator never remount its portal.
 *
 * Lexical can publish decorators one tick before `getElementByKey` sees the
 * host span. Skipping that frame left an empty mount until the next keystroke.
 * One rAF re-render retries host lookup. A cancelled (superseded) rAF must
 * not leave the arm latched, or later pastes stay invisible; a completed rAF
 * must keep the latch until the next decorator publish, or missing hosts
 * would schedule an infinite rAF loop.
 */
import * as React from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { LexicalEditor, NodeKey } from 'lexical'

/** Portal-loop props. */
export interface DecoratorPortalsProps {
  /** The bound editor; null (no-session) renders nothing. */
  readonly editor: LexicalEditor | null
}

/**
 * Render every decorator's React face into its editor host element.
 * @param props - the editor to observe.
 * @returns the live portal set.
 */
export function DecoratorPortals({ editor }: DecoratorPortalsProps): ReactNode {
  const [decorators, setDecorators] = React.useState<Record<NodeKey, React.JSX.Element>>(
    () => editor === null ? {} : editor.getDecorators<React.JSX.Element>(),
  )
  const retryArmed = React.useRef(false)

  React.useLayoutEffect(() => {
    if (editor === null) return
    setDecorators(editor.getDecorators<React.JSX.Element>())
    return editor.registerDecoratorListener<React.JSX.Element>((next) => {
      retryArmed.current = false
      setDecorators(next)
    })
  }, [editor])

  React.useLayoutEffect(() => {
    if (editor === null) return
    const keys = Object.keys(decorators)
    if (keys.length === 0) return
    if (!keys.some((key) => editor.getElementByKey(key) === null)) return
    if (retryArmed.current) return
    retryArmed.current = true
    let completed = false
    const raf = window.requestAnimationFrame(() => {
      completed = true
      setDecorators((prev) => ({ ...prev }))
    })
    return () => {
      window.cancelAnimationFrame(raf)
      // Completed paint keeps the latch (blocks rAF storms). Superseded arm releases.
      if (!completed) retryArmed.current = false
    }
  }, [editor, decorators])

  if (editor === null) return null
  return (
    <>
      {Object.entries(decorators).map(([key, jsx]) => {
        const el = editor.getElementByKey(key)
        return el === null ? null : createPortal(jsx, el, key)
      })}
    </>
  )
}
