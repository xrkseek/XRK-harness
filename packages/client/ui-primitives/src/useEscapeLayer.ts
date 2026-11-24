/**
 * React helper for the module Escape stack: while `active`, this owner is the
 * innermost layer and Escape runs `onEscape` (with preventDefault). Unmount or
 * `active=false` pops the token so outer panels can resume.
 */
import { useEffect, useRef } from 'react'
import { isTopEscapeLayer, popEscapeLayer, pushEscapeLayer } from './escape-layer.ts'

/**
 * Register an Escape consumer for the lifetime of `active`.
 * @param active - when false, no listener / no stack entry.
 * @param onEscape - close / dismiss callback (latest ref each render).
 */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!active) return
    const token = pushEscapeLayer()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (!isTopEscapeLayer(token)) return
      e.preventDefault()
      onEscapeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      popEscapeLayer(token)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
