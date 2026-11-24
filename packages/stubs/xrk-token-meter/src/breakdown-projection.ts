/**
 * Pure fold for the heuristic context-composition projection: system prompt
 * and tool schemas from the newest request envelope, conversation from the
 * live surface. Prices with the same shared estimator as the meter service,
 * so the three figures match `measure()`'s heuristic vocabulary exactly.
 */

import { z } from 'zod'
import { canonicalHeader } from '@xrkseek/xrk-session'
import type { ProjectionDefinition } from '@xrkseek/xrk-session-projection'
import { estimateSystemTokens, estimateToolsTokens } from './estimate.ts'
import { foldSurfaceProjection } from './surface-projection.ts'
import type { ShadowPriceClaim } from './surface-projection.ts'
// Import for the `contextBreakdown` SessionProjectionMap key merge.
import type {} from './projection.ts'

interface ContextBreakdownState {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
  /** Shadow price armed by the immediately preceding metering event. */
  claim?: ShadowPriceClaim
}

const breakdownSchema = z.object({
  systemTokens: z.number().int().nonnegative(),
  toolsTokens: z.number().int().nonnegative(),
  messageTokens: z.number().int().nonnegative(),
}).strict()

/**
 * Token-meter's context-composition projection unit.
 *
 * Envelope figures are last-wins per `request/header`; the message figure
 * rides {@link foldSurfaceProjection} — the same O(1) fold the occupancy
 * projection uses — so fully metered logs equal `measure().surfaceTokens` at
 * every event boundary and compaction shrinks the figure by its logged shadow
 * price. A replacement without a claim preserves the previous total. The
 * state is a fixed handful of numbers, so the persisted checkpoint stays
 * O(1) over the session's life.
 */
export const contextBreakdownProjectionDefinition:
ProjectionDefinition<'contextBreakdown', ContextBreakdownState> = {
  key: 'contextBreakdown',
  schema: breakdownSchema,
  init: () => ({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 }),
  apply: (state, event) => {
    const fold = foldSurfaceProjection(state.claim, event)
    let systemTokens = state.systemTokens
    let toolsTokens = state.toolsTokens
    if (event.type === 'request/header') {
      // Slim system-only envelopes omit tools — keep prior standing schemas
      // (foldRequestHeader merge). Empty tools[] still prices as 0.
      const header = canonicalHeader(event.data.header)
      if (header.system !== undefined) {
        systemTokens = estimateSystemTokens(header)
      }
      if (header.tools !== undefined && header.tools.length > 0) {
        toolsTokens = estimateToolsTokens(header)
      } else if (header.tools !== undefined && header.tools.length === 0) {
        toolsTokens = 0
      }
    }
    if (systemTokens === state.systemTokens
      && toolsTokens === state.toolsTokens
      && fold.deltaTokens === 0
      && fold.claim === undefined
      && state.claim === undefined) return state
    return {
      systemTokens,
      toolsTokens,
      messageTokens: state.messageTokens + fold.deltaTokens,
      ...fold.claim === undefined ? {} : { claim: fold.claim },
    }
  },
  view: ({ systemTokens, toolsTokens, messageTokens }) => ({ systemTokens, toolsTokens, messageTokens }),
  // v3: slim system-only envelopes keep prior tool schemas.
  stateVersion: 3,
}
