/** The agent-loop card's staged form over the `agent-loop` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  numberField,
  textField,
  type CardActions,
  type CardFieldSpec,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'
import { formatToolOrder, parseToolOrder } from './tool-order-draft.ts'

export { TOOL_ORDER_REST, formatToolOrder, parseToolOrder } from './tool-order-draft.ts'

/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop'

function toolOrderField(): CardFieldSpec {
  return {
    field: 'toolOrder',
    format: formatToolOrder,
    parse: parseToolOrder,
  }
}

/** The agent-loop fields this card edits. */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
  /** Max LLM steps (tool rounds) per user turn. */
  maxSteps?: number
  /**
   * DSH tool wire order: tool names with exactly one `' '` rest marker.
   * Empty / omit → lexicographic.
   */
  toolOrder?: readonly string[]
  /** `parallel` (default) or force `serial`. */
  toolSettle?: 'parallel' | 'serial'
  /** Max provider retries per step; `0` disables. */
  llmRetryMaxRetries?: number
  /** Soft context budget (messages + tool schemas). */
  maxRequestTokens?: number
  /** Tokens kept as recent tail after auto-compact. */
  keepTokens?: number
  /** Soft ceiling = maxRequestTokens − bufferTokens. */
  bufferTokens?: number
  /** Spill plain-text tool results over this UTF-8 ceiling; `0` disables. */
  toolResultMaxInlineBytes?: number
  /** Max subagent nesting depth (parent = 0). */
  maxSubagentDepth?: number
  /** Max concurrently draining direct children under one parent. */
  maxActiveSubagents?: number
}

/** What the agent-loop card renders. */
export interface AgentLoopCardState extends CardShell {
  /** Parallel tool-call cap. */
  maxParallelToolCalls: CardFieldState
  /** Steps-per-turn cap. */
  maxSteps: CardFieldState
  /** Tool wire order (comma-separated; empty slot = rest). */
  toolOrder: CardFieldState
  /** Settle mode. */
  toolSettle: CardFieldState
  /** Provider retry cap. */
  llmRetryMaxRetries: CardFieldState
  /** Soft request budget. */
  maxRequestTokens: CardFieldState
  /** Compaction keep tail. */
  keepTokens: CardFieldState
  /** Soft-budget buffer. */
  bufferTokens: CardFieldState
  /** Tool-result spill ceiling. */
  toolResultMaxInlineBytes: CardFieldState
  /** Subagent nesting depth cap. */
  maxSubagentDepth: CardFieldState
  /** Concurrent active subagent cap. */
  maxActiveSubagents: CardFieldState
}

/** The registration-side face the agent-loop card's slot entry injects. */
export interface AgentLoopCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAgentLoopCard. */
    agentLoopCard: SnapshotStore<AgentLoopCardState>
  }
}

/** Bridges the `agent-loop` scope onto the card's staged form. */
export class AgentLoopCardController {
  private readonly form: CardForm<AgentLoopSettings>
  private readonly store: SnapshotStore<AgentLoopCardState>

  /** @param scope - the bound settings scope for the `agent-loop` namespace. */
  constructor(scope: SettingsScope<AgentLoopSettings>) {
    this.form = new CardForm(scope, [
      numberField('maxParallelToolCalls'),
      numberField('maxSteps'),
      toolOrderField(),
      textField('toolSettle'),
      numberField('llmRetryMaxRetries'),
      numberField('maxRequestTokens'),
      numberField('keepTokens'),
      numberField('bufferTokens'),
      numberField('toolResultMaxInlineBytes'),
      numberField('maxSubagentDepth'),
      numberField('maxActiveSubagents'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): AgentLoopCardState {
    return {
      ...this.form.shell(),
      maxParallelToolCalls: this.form.field('maxParallelToolCalls'),
      maxSteps: this.form.field('maxSteps'),
      toolOrder: this.form.field('toolOrder'),
      toolSettle: this.form.field('toolSettle'),
      llmRetryMaxRetries: this.form.field('llmRetryMaxRetries'),
      maxRequestTokens: this.form.field('maxRequestTokens'),
      keepTokens: this.form.field('keepTokens'),
      bufferTokens: this.form.field('bufferTokens'),
      toolResultMaxInlineBytes: this.form.field('toolResultMaxInlineBytes'),
      maxSubagentDepth: this.form.field('maxSubagentDepth'),
      maxActiveSubagents: this.form.field('maxActiveSubagents'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): AgentLoopCardFace {
    return { hooks: { agentLoopCard: this.store }, ...this.form.actions() }
  }
}
