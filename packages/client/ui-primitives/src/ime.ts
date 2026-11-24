/**
 * IME composition guards for Enter-to-submit / Enter-to-select controls.
 *
 * Engines often emit keyCode 229 without `isComposing` during candidate commit.
 * Safari additionally delivers the closing keydown AFTER compositionend — a
 * short grace window (see {@link createCompositionWatch}) covers that tick.
 */

/** Default grace after compositionend for Safari's late closing keydown. */
export const COMPOSITION_GRACE_MS = 10

/**
 * True while an IME is composing or committing a candidate.
 * Pass {@link CompositionWatch.recentlyComposing} for the Safari grace tick.
 */
export function isComposingKeyboardEvent(
  event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>,
  recentlyComposing?: () => boolean,
): boolean {
  // keyCode 229 is the legacy IME-composition signal.
  // oxlint-disable-next-line typescript/no-deprecated
  if (event.isComposing || event.keyCode === 229) return true
  return recentlyComposing?.() === true
}

/** Root-element composition watch with a post-compositionend grace window. */
export interface CompositionWatch {
  /** True through composition and for one grace tick after compositionend. */
  recentlyComposing(): boolean
  /** Native composition flag (excludes the grace tick). */
  isNativeComposing(): boolean
  /**
   * Attach listeners to a root (or detach when `null`).
   * Replaces any previous root; safe to call on every root swap.
   */
  bind(root: HTMLElement | null): void
  /** Drop listeners without clearing the grace clock. */
  dispose(): void
}

/** Options for {@link createCompositionWatch}. */
export interface CompositionWatchOptions {
  /** ms to keep the guard after compositionend (Safari late keydown). */
  readonly graceMs?: number
  /** Fired when native composition starts/ends (not on grace expiry). */
  readonly onChange?: (nativeComposing: boolean) => void
}

/**
 * Build a composition watch for a focus root (composer Lexical root, etc.).
 */
export function createCompositionWatch(options: CompositionWatchOptions = {}): CompositionWatch {
  const graceMs = options.graceMs ?? COMPOSITION_GRACE_MS
  const onChange = options.onChange
  let composing = false
  let composingUntil = 0
  let root: HTMLElement | null = null

  const onCompositionStart = (): void => {
    composing = true
    onChange?.(true)
  }
  const onCompositionEnd = (): void => {
    composing = false
    composingUntil = Date.now() + graceMs
    onChange?.(false)
  }

  const detach = (): void => {
    if (root === null) return
    root.removeEventListener('compositionstart', onCompositionStart)
    root.removeEventListener('compositionend', onCompositionEnd)
    root = null
  }

  return {
    recentlyComposing: () => composing || Date.now() < composingUntil,
    isNativeComposing: () => composing,
    bind(next) {
      if (next === root) return
      detach()
      root = next
      if (root === null) {
        composing = false
        composingUntil = 0
        return
      }
      root.addEventListener('compositionstart', onCompositionStart)
      root.addEventListener('compositionend', onCompositionEnd)
    },
    dispose: detach,
  }
}
