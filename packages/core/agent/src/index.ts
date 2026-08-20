import type { CompactionOptions } from "@xrkseek/core-session";
import type { LlmAdapter, LlmChatRequest } from "@xrkseek/llm";
import {
  admitPrompt,
  createSessionSafety,
  createTurnLatch,
  hardLoopNotice,
  listPendingAdmits,
  promoteAdmitsForTurn,
  softLoopNotice,
  SessionBusyError,
  SessionSafetyLimitError,
  DEFAULT_COMPACTION_KEEP_TOKENS,
  deriveMessagesUnwindowed,
  selectHeadRecent,
  type AdmitReceipt,
  type SessionSafety,
  type SessionSafetyOptions,
  type SessionStore,
} from "@xrkseek/core-session";
import {
  addSafetyNotice,
  createToolPipeline,
  type ApprovalHandler,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import {
  runCompaction,
  runTurn,
  type AssembleOptions,
} from "@xrkseek/core-agent-loop";
import type { PromptDelivery, SafetyNoticePayload, MessageContent } from "@xrkseek/protocol";

export { SessionBusyError } from "@xrkseek/core-session";
export { NoPendingAdmitError } from "@xrkseek/core-session";
export { SessionSafetyLimitError } from "@xrkseek/core-session";

export interface AgentRunInput {
  /**
   * User text for this turn. Omit (or empty) to promote the oldest pending admit.
   * Prefer `continueTurn` naming at call sites.
   */
  readonly text?: string;
  readonly signal?: AbortSignal;
}

export interface AgentRunResult {
  readonly text: string;
  readonly turnId: string;
  readonly steps: number;
  /** First promoted admit id (back-compat). */
  readonly admitId?: string;
  /** All admits promoted for this turn (steer batch may be >1). */
  readonly admitIds?: readonly string[];
  /** True when this turn coalesced pending steers into one runTurn. */
  readonly steerBatch?: boolean;
}

export interface AgentHandle {
  /**
   * Continue on the same session log (ADR-0003).
   * With `text`: append user/message via runTurn and execute.
   * Without `text`: promote pending admits (all steers coalesced, else one queue), then execute.
   */
  continueTurn(input?: AgentRunInput): Promise<AgentRunResult>;
  /** @deprecated Prefer `continueTurn` — same behavior. */
  run(input: AgentRunInput & { text: string }): Promise<AgentRunResult>;
  /**
   * Admit-only: record prompt without model call.
   * Default delivery = queue; pass `{ delivery: "steer" }` to interrupt ahead of FIFO.
   */
  admit(
    content: MessageContent,
    options?: { readonly delivery?: PromptDelivery; readonly admitId?: string },
  ): AdmitReceipt;
  /** Pending admits not yet promoted. */
  pendingAdmits(): readonly AdmitReceipt[];
  abort(): void;
  isBusy(): boolean;
  /**
   * Wire human approval for pipeline `ask` (policy / pre).
   * Host Face uses this to bridge `session.respondApproval`.
   */
  setApprovalHandler(handler: ApprovalHandler | undefined): void;
  /** Presenters live on the registry; Face `viewFor` looks up by name. */
  readonly tools?: ToolRegistry;
  /**
   * Background jobs for Face `session/jobs` (DSH `ctx.jobs` on the live agent).
   * Omit → that agent contributes no task views.
   */
  readonly jobs?: {
    list(): readonly {
      readonly id: string;
      readonly kind: string;
      readonly label: string;
      readonly status:
        | "running"
        | "stopping"
        | "completed"
        | "killed"
        | "failed";
      readonly detail?: string;
      readonly startedAt: number;
      readonly finishedAt?: number;
      /** Internal — suppress Face completion notice after read/wait/kill. */
      readonly reported?: boolean;
      /** Producer UTF-8 cap for completion notice text. */
      readonly outputLimitBytes?: number;
    }[];
    onJobsChanged(listener: () => void): () => void;
  };
  /**
   * Manual `/compact` (DSH command-compact). Idle-only; does not join model history.
   */
  compactNow?(
    signal?: AbortSignal,
  ): Promise<CompactNowResult>;
}

export interface CompactNowResult {
  readonly compacted: boolean;
  readonly reason?: "busy" | "empty" | "summary";
  readonly shadowedMessages?: number;
  readonly shadowedTokens?: number;
  readonly summarySeq?: number;
}

export interface CreateAgentOptions {
  readonly sessionId: string;
  readonly store: SessionStore;
  readonly llm: LlmAdapter;
  readonly tools: ToolRegistry;
  readonly pipeline?: ToolPipeline;
  readonly system?: string;
  readonly assemble?: AssembleOptions;
  readonly maxSteps?: number;
  /**
   * Session-side mistake/loop trackers. Default enabled.
   * Pass `false` to disable.
   */
  readonly safety?: false | SessionSafetyOptions;
  /** Default `parallel` — see runTurn `toolSettle`. */
  readonly toolSettle?: "serial" | "parallel";
  /** Opt-in context compaction / one overflow retry. */
  readonly compaction?: false | CompactionOptions;
  /** Forwarded to runTurn for vision adapters. */
  readonly resolveImage?: LlmChatRequest["resolveImage"];
  /** Optional Face `session/jobs` source (bash background jobs). */
  readonly jobs?: AgentHandle["jobs"];
}

function mergeSignals(
  latchSignal: AbortSignal,
  outer?: AbortSignal,
  extra?: AbortSignal,
): AbortSignal {
  const parts = [latchSignal, outer, extra].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  if (parts.some((s) => s.aborted)) {
    const ac = new AbortController();
    ac.abort();
    return ac.signal;
  }
  if (parts.length === 1) return parts[0]!;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  for (const s of parts) {
    s.addEventListener("abort", onAbort, { once: true });
  }
  return ac.signal;
}

function attachSafetyPipeline(
  pipeline: ToolPipeline,
  safety: SessionSafety,
  getAbortTurn: () => (() => void) | undefined,
): void {
  if (!safety.loop.enabled) return;

  pipeline.onGuard((ctx) => {
    const verdict = safety.loop.inspect(ctx.call.name, ctx.args);
    if (verdict.kind === "soft") {
      safety.enqueueSoftNotice({
        kind: "loop_soft",
        content: softLoopNotice(verdict),
        toolName: verdict.toolName,
        count: verdict.count,
      });
      return "abstain";
    }
    if (verdict.kind === "hard") {
      const notice = hardLoopNotice(verdict);
      ctx.denyReason = notice;
      safety.enqueueSoftNotice({
        kind: "loop_hard",
        content: notice,
        toolName: verdict.toolName,
        count: verdict.count,
      });
      const hard = safety.onLoopHard(notice);
      if (hard.abortTurn) getAbortTurn()?.();
      return "deny";
    }
    return "abstain";
  });

  pipeline.onPost((ctx) => {
    for (const notice of safety.takeSoftNotices()) {
      addSafetyNotice(ctx, notice);
    }
    return { action: "accept" };
  });
}

function appendSafetyNoticeEvent(
  store: SessionStore,
  sessionId: string,
  turnId: string,
  notice: SafetyNoticePayload,
): void {
  store.append(sessionId, {
    type: "safety/notice",
    ts: Date.now(),
    turnId,
    kind: notice.kind,
    content: notice.content,
    ...(notice.toolName !== undefined ? { toolName: notice.toolName } : {}),
    ...(notice.count !== undefined ? { count: notice.count } : {}),
  });
}

/** Thin handle over `runTurn` with TurnLatch + admit + session safety (ADR-0003). */
export function createAgent(options: CreateAgentOptions): AgentHandle {
  const latch = createTurnLatch({ sessionId: options.sessionId });
  const safety =
    options.safety === false
      ? undefined
      : createSessionSafety(options.safety ?? {});
  const pipeline = options.pipeline ?? createToolPipeline();

  let abortTurnRef: (() => void) | undefined;
  if (safety) {
    attachSafetyPipeline(pipeline, safety, () => abortTurnRef);
  }

  const continueTurn = async (
    input: AgentRunInput = {},
  ): Promise<AgentRunResult> => {
    return latch.run(async (latchSignal) => {
      let userText = input.text?.trim() ? input.text : undefined;
      let userContent: MessageContent | undefined = userText;
      let admitId: string | undefined;
      let admitIds: string[] | undefined;
      let steerBatch: boolean | undefined;
      if (userText === undefined) {
        const promoted = promoteAdmitsForTurn(
          options.store,
          options.sessionId,
        );
        userText = promoted.text;
        userContent = promoted.content;
        admitId = promoted.receipts[0]?.admitId;
        admitIds = promoted.receipts.map((r) => r.admitId);
        if (promoted.steerBatch) steerBatch = true;
      }

      const turnAbort = new AbortController();
      abortTurnRef = () => turnAbort.abort();

      const signal = mergeSignals(latchSignal, input.signal, turnAbort.signal);

      try {
        let result;
        try {
          result = await runTurn({
            sessionId: options.sessionId,
            userText,
            userContent: userContent ?? userText,
            store: options.store,
            llm: options.llm,
            tools: options.tools,
            signal,
            pipeline,
            ...(options.system !== undefined ? { system: options.system } : {}),
            ...(options.assemble ? { assemble: options.assemble } : {}),
            ...(options.maxSteps !== undefined
              ? { maxSteps: options.maxSteps }
              : {}),
            ...(options.toolSettle !== undefined
              ? { toolSettle: options.toolSettle }
              : {}),
            ...(options.compaction !== undefined
              ? { compaction: options.compaction }
              : {}),
            ...(options.resolveImage
              ? { resolveImage: options.resolveImage }
              : {}),
          });
        } catch (err) {
          if (
            safety &&
            err instanceof DOMException &&
            err.name === "AbortError" &&
            turnAbort.signal.aborted &&
            !latchSignal.aborted &&
            !input.signal?.aborted
          ) {
            const snap = safety.loop.snapshot();
            const message =
              safety.consumeAbortMessage() ??
              hardLoopNotice({
                kind: "hard",
                count: snap.consecutiveIdenticalCount,
                toolName: snap.lastToolName,
                signature: snap.lastToolSignature,
              });
            // Notice may already be in the log from the hard tool's batch flush.
            const events = options.store.get(options.sessionId).events;
            const already = events.some(
              (e) =>
                e.type === "safety/notice" &&
                e.kind === "loop_hard" &&
                e.content === message,
            );
            if (!already) {
              appendSafetyNoticeEvent(
                options.store,
                options.sessionId,
                "turn_safety",
                { kind: "loop_hard", content: message },
              );
            }
            throw new SessionSafetyLimitError(message, "tool_loop_hard");
          }
          if (
            safety &&
            !(err instanceof DOMException && err.name === "AbortError") &&
            !(err instanceof SessionSafetyLimitError)
          ) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              safety.onApiError(msg);
            } catch (limitErr) {
              if (limitErr instanceof SessionSafetyLimitError) {
                appendSafetyNoticeEvent(
                  options.store,
                  options.sessionId,
                  "turn_safety",
                  {
                    kind: "mistake_limit",
                    content: limitErr.message,
                  },
                );
              }
              throw limitErr;
            }
          }
          throw err;
        }

        if (safety) {
          try {
            safety.afterTurn({ ok: result.toolOk, failed: result.toolFailed });
          } catch (limitErr) {
            if (limitErr instanceof SessionSafetyLimitError) {
              appendSafetyNoticeEvent(
                options.store,
                options.sessionId,
                result.turnId,
                {
                  kind: "mistake_limit",
                  content: limitErr.message,
                },
              );
            }
            throw limitErr;
          }
        }

        return {
          text: result.assistantText,
          turnId: result.turnId,
          steps: result.steps,
          ...(admitId ? { admitId } : {}),
          ...(admitIds?.length ? { admitIds } : {}),
          ...(steerBatch ? { steerBatch: true } : {}),
        };
      } finally {
        abortTurnRef = undefined;
      }
    });
  };

  return {
    continueTurn,
    run(input) {
      if (!input.text?.trim()) {
        throw new Error(
          "run() requires text; use continueTurn() to promote admits",
        );
      }
      return continueTurn(input);
    },
    admit(content, admitOptions) {
      return admitPrompt(
        options.store,
        options.sessionId,
        content,
        admitOptions,
      );
    },
    pendingAdmits() {
      return listPendingAdmits(
        options.store.get(options.sessionId).events,
        options.sessionId,
      );
    },
    isBusy() {
      return latch.isActive();
    },
    abort() {
      latch.cancel();
    },
    setApprovalHandler(handler) {
      pipeline.setApprovalHandler(handler);
    },
    tools: options.tools,
    ...(options.jobs ? { jobs: options.jobs } : {}),
    async compactNow(signal) {
      try {
        return await latch.run(async (latchSignal) => {
          const keep =
            (options.compaction !== false &&
              options.compaction?.keepTokens) ||
            DEFAULT_COMPACTION_KEEP_TOKENS;
          const events = options.store.get(options.sessionId).events;
          const selected = selectHeadRecent(
            deriveMessagesUnwindowed(events),
            keep,
          );
          if (!selected || selected.headMessageCount === 0) {
            return { compacted: false as const, reason: "empty" as const };
          }
          const merged = mergeSignals(latchSignal, signal);
          const result = await runCompaction({
            store: options.store,
            sessionId: options.sessionId,
            llm: options.llm,
            reason: "manual",
            keepTokens: keep,
            signal: merged,
          });
          if (!result.compacted) {
            return { compacted: false as const, reason: "summary" as const };
          }
          return {
            compacted: true as const,
            shadowedMessages: selected.headMessageCount,
            shadowedTokens: result.event!.shadowedTokenCount!,
            summarySeq: options.store.get(options.sessionId).events.length,
          };
        });
      } catch (err) {
        if (err instanceof SessionBusyError) {
          return { compacted: false, reason: "busy" };
        }
        throw err;
      }
    },
  };
}

export type { AssembleOptions, AdmitReceipt, SessionSafetyOptions };
