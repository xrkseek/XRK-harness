/**
 * Overview soft faces over Session conversation state.
 *
 * Publish-on-notify only: `getSnapshot` returns the last published reference and
 * never calls `session.getSnapshot()` itself. Live ensureFresh inside getSnapshot
 * tears under large-history markDirty floods (React #185 → details abdicate).
 */
import type { SessionId } from '@xrkseek/client-runtime/client'
import {
  changeTurnsFallbackSnapshot,
  EMPTY_CHANGE_TURNS_FALLBACK,
} from './change-turns-fallback.ts'
import {
  EMPTY_PRESENCE_SESSION_CUES,
  PRESENCE_TOOL_ERROR_MS,
  latestToolErrorCue,
  presenceSessionCuesSnapshot,
  type PresenceSessionCues,
  type PresenceTimelineNode,
} from './presence-session-cues.ts'
import type { OverviewChangesTurn } from './OverviewChangesPanel.tsx'

/** Minimal Session binding the faces need (avoids pulling the full manager type). */
export type OverviewSessionBinding = {
  readonly session: {
    getSnapshot: () => {
      readonly nodes: readonly PresenceTimelineNode[]
      readonly chat: {
        readonly timeline: Parameters<typeof changeTurnsFallbackSnapshot>[1]
      }
    }
    subscribe: (listener: () => void) => () => void
  }
}

export type OverviewSessionSoftFaces = {
  readonly changeTurnsFallback: {
    getSnapshot: () => readonly OverviewChangesTurn[]
    subscribe: (listener: () => void) => () => void
  }
  readonly presenceCues: {
    getSnapshot: () => PresenceSessionCues
    subscribe: (listener: () => void) => () => void
  }
}

/**
 * Build identity-stable soft faces for one Session inject cache entry.
 * @param sessionId - Overview Session id.
 * @param bindingOf - live binding lookup (may be absent while cold).
 */
export function createOverviewSessionSoftFaces(
  sessionId: SessionId,
  bindingOf: (id: SessionId) => OverviewSessionBinding | undefined,
): OverviewSessionSoftFaces {
  let publishedTurns: readonly OverviewChangesTurn[] = EMPTY_CHANGE_TURNS_FALLBACK
  let publishedCues: PresenceSessionCues = EMPTY_PRESENCE_SESSION_CUES
  let cueExpireTimer: ReturnType<typeof setTimeout> | undefined
  const cueListeners = new Set<() => void>()

  /** @returns true when the published reference changed. */
  const publishTurns = (): boolean => {
    const prev = publishedTurns
    try {
      const binding = bindingOf(sessionId)
      publishedTurns = binding === undefined
        ? EMPTY_CHANGE_TURNS_FALLBACK
        : changeTurnsFallbackSnapshot(
          sessionId,
          binding.session.getSnapshot().chat.timeline,
        )
    } catch {
      publishedTurns = EMPTY_CHANGE_TURNS_FALLBACK
    }
    return publishedTurns !== prev
  }

  /** @returns true when the published reference changed. */
  const publishCues = (): boolean => {
    if (cueExpireTimer !== undefined) {
      clearTimeout(cueExpireTimer)
      cueExpireTimer = undefined
    }
    const prev = publishedCues
    try {
      const binding = bindingOf(sessionId)
      if (binding === undefined) {
        publishedCues = EMPTY_PRESENCE_SESSION_CUES
      } else {
        const nowMs = Date.now()
        const nodes = binding.session.getSnapshot().nodes
        publishedCues = presenceSessionCuesSnapshot(sessionId, nodes, nowMs)
        // Tool-error TTL must expire without a session notify — schedule one
        // republish so getSnapshot never changes behind uSES's back.
        const err = latestToolErrorCue(nodes, nowMs)
        if (err !== undefined && err.at > 0) {
          const remain = PRESENCE_TOOL_ERROR_MS - (nowMs - err.at)
          if (remain > 0) {
            cueExpireTimer = setTimeout(() => {
              cueExpireTimer = undefined
              if (publishCues()) {
                for (const listener of cueListeners) listener()
              }
            }, remain + 1)
          }
        }
      }
    } catch {
      publishedCues = EMPTY_PRESENCE_SESSION_CUES
    }
    return publishedCues !== prev
  }

  return {
    changeTurnsFallback: {
      getSnapshot: () => publishedTurns,
      subscribe: (listener) => {
        const binding = bindingOf(sessionId)
        if (binding === undefined) {
          publishedTurns = EMPTY_CHANGE_TURNS_FALLBACK
          return () => {}
        }
        publishTurns()
        return binding.session.subscribe(() => {
          if (publishTurns()) listener()
        })
      },
    },
    presenceCues: {
      getSnapshot: () => publishedCues,
      subscribe: (listener) => {
        const binding = bindingOf(sessionId)
        if (binding === undefined) {
          publishedCues = EMPTY_PRESENCE_SESSION_CUES
          return () => {}
        }
        cueListeners.add(listener)
        publishCues()
        const unsub = binding.session.subscribe(() => {
          if (publishCues()) listener()
        })
        return () => {
          cueListeners.delete(listener)
          unsub()
          if (cueListeners.size === 0 && cueExpireTimer !== undefined) {
            clearTimeout(cueExpireTimer)
            cueExpireTimer = undefined
          }
        }
      },
    },
  }
}
