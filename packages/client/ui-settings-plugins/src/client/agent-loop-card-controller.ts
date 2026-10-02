/** The agent-loop card's staged form over the `agent-loop` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@xrkseek/client-runtime/client'
import {
  CardForm,
  booleanField,
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

const COMPACTION_STRATEGIES = new Set([
  'prune-summary',
  'prune-only',
  'summary-only',
  'off',
])

function compactionStrategyField(): CardFieldSpec {
  return {
    field: 'compactionStrategy',
    format: (value) =>
      typeof value === 'string' && COMPACTION_STRATEGIES.has(value) ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return COMPACTION_STRATEGIES.has(trimmed)
        ? { kind: 'set', value: trimmed }
        : undefined
    },
  }
}

/** The agent-loop fields this card edits. */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
  /** Max LLM steps (tool rounds) per user turn. */
  maxSteps?: number
  /** Resume automatically when a model stops at its output token cap. */
  autoContinueOnMaxTokens?: boolean
  /** Maximum automatic continuations per turn (independent of maxSteps). */
  autoContinueMaxRounds?: number
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
  /**
   * Soft-budget strategy: `prune-summary` (default) · `prune-only` ·
   * `summary-only` · `off`.
   */
  compactionStrategy?: 'prune-summary' | 'prune-only' | 'summary-only' | 'off'
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
  /** Auto-resume on max-tokens. */
  autoContinueOnMaxTokens: CardFieldState
  /** Automatic continuation cap per turn. */
  autoContinueMaxRounds: CardFieldState
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
  /** Soft-budget strategy family. */
  compactionStrategy: CardFieldState
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
      booleanField('autoContinueOnMaxTokens'),
      numberField('autoContinueMaxRounds'),
      toolOrderField(),
      textField('toolSettle'),
      numberField('llmRetryMaxRetries'),
      numberField('maxRequestTokens'),
      numberField('keepTokens'),
      numberField('bufferTokens'),
      compactionStrategyField(),
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
      autoContinueOnMaxTokens: this.form.field('autoContinueOnMaxTokens'),
      autoContinueMaxRounds: this.form.field('autoContinueMaxRounds'),
      toolOrder: this.form.field('toolOrder'),
      toolSettle: this.form.field('toolSettle'),
      llmRetryMaxRetries: this.form.field('llmRetryMaxRetries'),
      maxRequestTokens: this.form.field('maxRequestTokens'),
      keepTokens: this.form.field('keepTokens'),
      bufferTokens: this.form.field('bufferTokens'),
      compactionStrategy: this.form.field('compactionStrategy'),
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
