/**
 * FLIP the Overview 委派方 stack when Face reorders parents by recent bubble.
 * Keeps the seat that just spoke sliding into the lead slot instead of jumping.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

const FLIP_MS = 380
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function useDelegateStackFlip(
  stackKey: string,
  enabled: boolean,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const prevBoxes = useRef<Map<string, DOMRect>>(new Map())
  const prevKey = useRef(stackKey)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !enabled) {
      prevBoxes.current = new Map()
      prevKey.current = stackKey
      return
    }

    const layers = Array.from(
      root.querySelectorAll<HTMLElement>('[data-delegate-flip-id]'),
    )
    const nextBoxes = new Map<string, DOMRect>()
    for (const el of layers) {
      const id = el.dataset.delegateFlipId
      if (!id) continue
      nextBoxes.set(id, el.getBoundingClientRect())
    }

    const orderChanged = prevKey.current !== stackKey
    if (orderChanged && prevBoxes.current.size > 0) {
      for (const el of layers) {
        const id = el.dataset.delegateFlipId
        if (!id) continue
        const first = prevBoxes.current.get(id)
        const last = nextBoxes.get(id)
        if (!first || !last) continue
        const dx = first.left - last.left
        const dy = first.top - last.top
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
        el.style.transition = 'none'
        el.style.transform = `translate(${dx}px, ${dy}px)`
        // Force style flush before releasing to the lead/peek CSS transform.
        void el.offsetWidth
        el.style.transition =
          `transform ${FLIP_MS}ms ${FLIP_EASING}, opacity ${Math.round(FLIP_MS * 0.75)}ms ease`
        el.style.transform = ''
        const clear = (): void => {
          el.style.transition = ''
          el.removeEventListener('transitionend', clear)
        }
        el.addEventListener('transitionend', clear)
      }
    }

    prevBoxes.current = nextBoxes
    prevKey.current = stackKey
  }, [stackKey, enabled])

  return ref
}
