/**
 * Boot stall window — the kernel's "keep waiting, but not forever" primitive.
 * One boot stage (entry creation + loader quiesce) is judged by silence, not by
 * wall clock: {@link StallWatch.notify} re-arms the window on every sign of
 * movement (a projected fiber transition, a settled entry creation) and
 * `blocked()` re-arms it for work that carries its own time budget somewhere
 * else (a bundle still on the wire — the network has no deadline here).
 *
 * Shell-own, dependency-free (shell self-sufficiency rule: the loading page
 * must not depend on the system whose failure it reports).
 * @module @xrkseek/client-web/src/boot-stall
 */

/** Handle on one re-arming stall window. */
export interface StallWatch {
  /** Resolves once the window elapses without movement; never rejects. */
  readonly stalled: Promise<void>
  /** Report progress: restart the window. No-op after the window fired or was disposed. */
  notify: () => void
  /** Stop watching (stage settled). Late notifications and the timer become no-ops. */
  dispose: () => void
}

/**
 * Create a re-arming stall window.
 * @param stallMs - quiet period that counts as a stall.
 * @param blocked - Optional: true when the silence is expected (re-arms instead of firing).
 * @returns the watch handle.
 */
export function watchStall(stallMs: number, blocked?: () => boolean): StallWatch {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  let wake: (() => void) | undefined
  const stalled = new Promise<void>((resolve) => { wake = resolve })
  const arm = (): void => {
    timer = setTimeout(() => {
      if (blocked?.() === true) {
        arm()
        return
      }
      done = true
      wake?.()
    }, stallMs)
  }
  arm()
  return {
    stalled,
    notify: () => {
      if (done) return
      if (timer !== undefined) clearTimeout(timer)
      arm()
    },
    dispose: () => {
      done = true
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
