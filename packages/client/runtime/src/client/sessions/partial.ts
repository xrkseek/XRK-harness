// PartialAccumulator: assistant/chunk accumulator.
// Folds the six StreamChunk variants into AssistantBlock[] keyed by block index;
// block-level immutability (a delta only swaps that block's reference).

import type { StreamChunk } from '@xrkseek/xrk-llm/types'
import type { AssistantBlock, PartialAssistant } from './conversation.ts'
import { toAssistantBlock } from './conversation.ts'

/**
 * Whether a stream chunk changes the partial assistant projection shown by the UI.
 * @param type - Stream chunk discriminant.
 * @returns Whether publishing the accumulated partial can change the visible snapshot.
 */
export function isVisibleAssistantChunk(type: string): boolean {
  return type === 'block-start'
    || type === 'text-delta'
    || type === 'reasoning-delta'
    || type === 'tool-call-delta'
    || type === 'block-end'
}

/**
 * Slot for a tool-call-delta that must not overwrite reasoning (0) / text (1).
 *
 * OpenAI-compatible vendors emit `tool_calls[].index` from 0; adapters may
 * already offset to 2+, but packed history and other adapters still land on
 * 0/1. Reuse the callId's existing tool slot when present; otherwise park at
 * ≥2 so Think / answer stay intact for expand.
 */
export function toolCallBlockIndex(
  blocks: readonly (AssistantBlock | undefined)[],
  wireIndex: number,
  callId: string,
): number {
  const id = callId.trim()
  if (id !== '') {
    const byId = blocks.findIndex(
      (block) => block?.kind === 'tool-call' && block.callId === id,
    )
    if (byId >= 0) return byId
  }
  const occupant = blocks[wireIndex]
  // Empty or already a tool lane: same vendor index continues that call
  // (identity pinning still prefers the first non-empty callId).
  if (occupant === undefined || occupant.kind === 'tool-call') return wireIndex
  // reasoning / text / other — never clobber Think or the answer mid-stream.
  return Math.max(2, blocks.length)
}

/** assistant/chunk accumulator: folds StreamChunks into AssistantBlock[] with block-level immutability. */
export class PartialAccumulator {
  // Sparse on purpose: block-start may arrive out of order, leaving holes until compaction.
  private blocks: (AssistantBlock | undefined)[] = []
  private changed = true
  private snapshot: PartialAssistant

  /**
   * @param turn - Owning agent turn.
   * @param step - Owning model step.
   * @param initialBlocks - Materialized prefix when accumulation begins after history replay.
   */
  constructor(
    readonly turn: number,
    readonly step: number,
    initialBlocks: readonly AssistantBlock[] = [],
  ) {
    this.blocks = [...initialBlocks]
    this.snapshot = { turn, step, blocks: initialBlocks }
  }

  /**
   * Fold one chunk.
   * @param chunk - the stream chunk.
   * @returns whether it caused a visible change (usage/finish return false, skipping notification).
   */
  push(chunk: StreamChunk): boolean {
    switch (chunk.type) {
      case 'block-start': {
        this.blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
        this.changed = true
        return true
      }
      case 'text-delta': {
        const prev = this.blocks[chunk.index]
        this.blocks[chunk.index] = { kind: 'text', text: (prev?.kind === 'text' ? prev.text : '') + chunk.text }
        this.changed = true
        return true
      }
      case 'reasoning-delta': {
        const prev = this.blocks[chunk.index]
        this.blocks[chunk.index] = { kind: 'reasoning', text: (prev?.kind === 'reasoning' ? prev.text : '') + chunk.text }
        this.changed = true
        return true
      }
      case 'tool-call-delta': {
        const callId = String(chunk.id)
        const slot = toolCallBlockIndex(this.blocks, chunk.index, callId)
        const prev = this.blocks[slot]
        const base = prev?.kind === 'tool-call' ? prev : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
        this.blocks[slot] = {
          kind: 'tool-call',
          callId: base.callId || callId,
          name: chunk.name ?? base.name,
          argsRaw: base.argsRaw + chunk.argumentsDelta,
        }
        this.changed = true
        return true
      }
      case 'block-end': {
        this.blocks[chunk.index] = toAssistantBlock(chunk.block)
        this.changed = true
        return true
      }
      default:
        // usage / finish / merge-extensible unknown variants: no visible block change
        // (finish is immediately followed by the assistant/message that supersedes the partial).
        return false
    }
  }

  /**
   * Current partial projection.
   * @returns the cached snapshot (the blocks array reference only changes after a mutation).
   */
  toPartial(): PartialAssistant {
    if (this.changed) {
      // Compact sparse indexes (out-of-order block-start) into render order.
      this.snapshot = { turn: this.turn, step: this.step, blocks: this.blocks.filter((b): b is AssistantBlock => b !== undefined) }
      this.changed = false
    }
    return this.snapshot
  }
}

/**
 * Create the empty client projection for one streamed Assistant block kind.
 * @param blockType - wire block kind.
 * @returns empty projected block ready to receive deltas.
 */
export function emptyAssistantBlock(blockType: string): AssistantBlock {
  switch (blockType) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'tool-call': return { kind: 'tool-call', callId: '', name: '', argsRaw: '' }
    default: return { kind: 'other', block: null }
  }
}
