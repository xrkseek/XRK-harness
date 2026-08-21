import {
  assertModelVisible,
  assertToolCallsSettled,
  deriveMessages,
  estimateMessagesTokens,
  pruneOversizedToolResults,
  settleDanglingTools,
  DEFAULT_COMPACTION_BUFFER_TOKENS,
  DEFAULT_COMPACTION_KEEP_TOKENS,
  type CompactionOptions,
  type SessionStore,
} from "@xrkseek/core-session";
import {
  assembleThreeLayers,
  type AssembledRequest,
} from "@xrkseek/core-system-prompt";
import {
  materializeTools,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import {
  finalizeLlmChatResponse,
  isContextOverflowError,
  isEmptyResponseError,
  isIncompleteToolCallError,
  isLlmError,
  isProviderFinishError,
  isUnsupportedReasoningEffortError,
  UnsupportedContentError,
  type LlmAdapter,
  type LlmChatRequest,
  type LlmChatResponse,
  type ResolvedRetryPolicy,
} from "@xrkseek/llm";
import type {
  ChatMessage,
  MessageContent,
  SafetyNoticePayload,
  SessionEvent,
  TokenUsage,
  TurnEndReason,
} from "@xrkseek/protocol";
import {
  contentHasImage,
  flattenText,
  parseSessionEvent,
  parseTurnEndCancelCause,
  DEFAULT_PLAN_POLICY_SECTION,
  foldPlanMode,
  pendingPlanTarget,
} from "@xrkseek/protocol";
import { resolveCompactionOptions, runCompaction } from "./compaction.js";
import { maybeAppendRequestHeader } from "./request-header-log.js";
import {
  MAX_STEPS_PROMPT,
  MAX_STEPS_TOOL_DISABLED,
} from "./max-steps.js";
import { settleToolBatch, type ToolSettleMode } from "./settle-batch.js";
import {
  finalizeCancelledTurn,
  isAbortError,
} from "./cancel-finalize.js";
import {
  invokeLlmWithRetry,
  resolveRetryPolicy,
} from "./llm-retry.js";

export interface AssembleOptions {
  readonly persona?: string;
  readonly mcpProtocol?: string;
  readonly owner?: string;
  readonly workspaceBlocks?: readonly string[];
  /**
   * Optional DSH `toolOrder` (exactly one `' '` rest). Forwarded to
   * `assembleThreeLayers`; omit → lexicographic tool wire order.
   */
  readonly toolOrder?: readonly string[];
  /** When false, skip three-layer and use legacy system+history. Default true if assemble set. */
  readonly enabled?: boolean;
  /**
   * Expand `/id …` (recipe or skill) before the user message is logged.
   * Return undefined to keep raw text. Typically wired to workspace `createSlashResolver`.
   */
  readonly resolveSlash?: (
    raw: string,
  ) =>
    | {
        readonly userPrompt: string;
        readonly systemExtra?: string;
        readonly recipeId?: string;
      }
    | undefined
    | Promise<
        | {
            readonly userPrompt: string;
            readonly systemExtra?: string;
            readonly recipeId?: string;
          }
        | undefined
      >;
}

export interface RunTurnInput {
  readonly sessionId: string;
  readonly userText: string;
  /**
   * Session log content for `user/message` (string or ContentBlock[]).
   * Defaults to `userText`. Images are persisted as refs; adapter without
   * `image` in `inputModalities` hard-fails.
   */
  readonly userContent?: MessageContent;
  /**
   * Resolve attachment bytes when user content includes image refs.
   * Required by vision adapters; unused on text-only routes.
   */
  readonly resolveImage?: LlmChatRequest["resolveImage"];
  readonly system?: string;
  readonly assemble?: AssembleOptions;
  readonly store: SessionStore;
  readonly llm: LlmAdapter;
  readonly tools: ToolRegistry;
  readonly pipeline?: ToolPipeline;
  readonly signal?: AbortSignal;
  readonly maxSteps?: number;
  readonly now?: () => number;
  /**
   * How to settle multiple tool calls in one step.
   * Default `parallel`: call-barrier → concurrent settle → ordered results.
   * Use `serial` for strict one-at-a-time (e.g. heavy write tools).
   */
  readonly toolSettle?: ToolSettleMode;
  /**
   * Cap concurrent tool settles when `toolSettle` is `parallel`.
   * Face Plugins → Agent loop → `maxParallelToolCalls`.
   */
  readonly maxParallelToolCalls?: number;
  /**
   * Context compaction / overflow recovery (opt-in).
   * Pass `false` or omit to disable. Object enables auto + one overflow retry.
   */
  readonly compaction?: false | CompactionOptions;
  /**
   * Provider request retries within a step (DSH llm-retry).
   * Default: normal mode, max 5, retryable EMPTY_RESPONSE / RATE_LIMIT /
   * SERVER / TIMEOUT / TRANSPORT. Pass `false` to disable.
   */
  readonly llmRetry?: false | Partial<ResolvedRetryPolicy>;
}

export interface RunTurnResult {
  readonly turnId: string;
  readonly assistantText: string;
  readonly steps: number;
  readonly toolOk: number;
  readonly toolFailed: number;
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function append(
  store: SessionStore,
  sessionId: string,
  event: SessionEvent,
): void {
  store.append(sessionId, event);
}

/** Commit a queued `/plan` selection before the next request assembly. */
function commitPendingPlanMode(
  store: SessionStore,
  sessionId: string,
  now: () => number,
): void {
  const target = pendingPlanTarget(store.get(sessionId).events);
  if (target === null) return;
  append(store, sessionId, {
    type: "plan/mode",
    ts: now(),
    active: target,
  });
}

function llmAllowsImage(llm: LlmAdapter): boolean {
  return (llm.inputModalities ?? ["text"]).includes("image");
}

function toLlmRequest(
  input: RunTurnInput,
  req: { messages: ChatMessage[]; tools: AssembledRequest["tools"] },
): LlmChatRequest {
  let reasoningEffort: string | undefined;
  try {
    reasoningEffort =
      input.llm.ensureRoute?.()?.reasoningEffort ??
      input.llm.peekRoute?.()?.reasoningEffort;
  } catch {
    reasoningEffort = input.llm.peekRoute?.()?.reasoningEffort;
  }
  return {
    messages: req.messages,
    ...(req.tools.length ? { tools: req.tools } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.resolveImage ? { resolveImage: input.resolveImage } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}

async function invokeLlm(
  input: RunTurnInput,
  req: { messages: ChatMessage[]; tools: AssembledRequest["tools"] },
  onChunk: (chunk: {
    kind: "text" | "reasoning" | "usage" | "tool-call";
    index: number;
    text: string;
    usage?: TokenUsage;
    toolCallId?: string;
    toolName?: string;
    argumentsDelta?: string;
  }) => void,
): Promise<LlmChatResponse> {
  const request = toLlmRequest(input, req);
  if (!input.llm.stream) {
    return finalizeLlmChatResponse(await input.llm.chat(request));
  }
  let content = "";
  let reasoning = "";
  let toolCalls: LlmChatResponse["toolCalls"];
  let usage: TokenUsage | undefined;
  let finishReason: LlmChatResponse["finishReason"];
  let finishError: LlmChatResponse["finishError"];
  for await (const ev of input.llm.stream(request)) {
    if (input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    if (ev.type === "reasoning-delta") {
      if (ev.text) {
        reasoning += ev.text;
        onChunk({ kind: "reasoning", index: ev.index, text: ev.text });
      }
    } else if (ev.type === "text-delta") {
      if (ev.text) {
        content += ev.text;
        onChunk({ kind: "text", index: ev.index, text: ev.text });
      }
    } else if (ev.type === "tool-call-delta") {
      onChunk({
        kind: "tool-call",
        index: ev.index,
        text: ev.argumentsDelta,
        toolCallId: ev.id,
        ...(ev.name ? { toolName: ev.name } : {}),
        argumentsDelta: ev.argumentsDelta,
      });
    } else if (ev.type === "usage") {
      usage = ev.usage;
      onChunk({ kind: "usage", index: 0, text: "", usage: ev.usage });
    } else if (ev.type === "done") {
      content = ev.content || content;
      if (ev.reasoning) reasoning = ev.reasoning;
      if (ev.toolCalls) toolCalls = ev.toolCalls;
      if (ev.usage) usage = ev.usage;
      if (ev.finishReason) finishReason = ev.finishReason;
      if (ev.finishError) finishError = ev.finishError;
    }
  }
  return finalizeLlmChatResponse({
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(finishError ? { finishError } : {}),
  });
}

function buildModelRequest(input: {
  events: readonly SessionEvent[];
  sessionId: string;
  system?: string;
  assemble?: AssembleOptions;
  tools: { list(): readonly { name: string; description: string; parameters: Record<string, unknown> }[] };
  nowIso: string;
  /** First LLM call in the turn still treats userText as skeleton user. */
  firstStep: boolean;
  userText: string;
  /** Recipe instructions from slash expand (appended as workspace block). */
  slashSystemExtra?: string;
}): { system?: string; messages: ChatMessage[]; tools: AssembledRequest["tools"] } {
  const derived = deriveMessages(input.events);
  assertModelVisible(input.events, derived);

  const toolDefs = [...input.tools.list()]
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const useAssemble = input.assemble && input.assemble.enabled !== false;
  if (!useAssemble) {
    const planExtra = foldPlanMode(input.events)
      ? DEFAULT_PLAN_POLICY_SECTION
      : "";
    const system = [input.system, planExtra].filter((s) => s?.trim()).join("\n\n");
    const messages: ChatMessage[] = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push(...derived);
    return {
      ...(system ? { system } : {}),
      messages,
      tools: toolDefs,
    };
  }

  // Logged history is source of truth. On the first step, drop the trailing
  // user message so three-layer can place it as skeleton user; later steps
  // keep full derived history (tools/results already logged).
  let history = derived;
  let skeletonText = "";
  if (input.firstStep && history.length > 0) {
    const last = history[history.length - 1];
    if (last?.role === "user" && !contentHasImage(last.content)) {
      const lastText =
        typeof last.content === "string"
          ? last.content
          : flattenText(last.content);
      if (lastText === input.userText) {
        history = history.slice(0, -1);
        skeletonText = input.userText;
      }
    }
  }

  const assembled = assembleThreeLayers({
    skeletonSystem: {
      ...(input.assemble?.persona !== undefined
        ? { persona: input.assemble.persona }
        : input.system !== undefined
          ? { persona: input.system }
          : {}),
      ...(input.assemble?.mcpProtocol
        ? { mcpProtocol: input.assemble.mcpProtocol }
        : {}),
    },
    history,
    skeletonUser: { text: skeletonText || "\u200b" },
    volatile: {
      nowIso: input.nowIso,
      sessionId: input.sessionId,
      ...(input.assemble?.owner ? { owner: input.assemble.owner } : {}),
    },
    // Follow-ups: keep conversation prefix byte-stable for provider cache
    // (DSH append-only). Marker + changing clock only on the opening step.
    includeCurrentMarker: input.firstStep === true,
    includeVolatileTime: input.firstStep === true,
    tools: toolDefs,
    ...(input.assemble?.toolOrder ? { toolOrder: input.assemble.toolOrder } : {}),
    ...(input.assemble?.workspaceBlocks ||
    input.slashSystemExtra ||
    foldPlanMode(input.events)
      ? {
          workspaceBlocks: [
            ...(input.assemble?.workspaceBlocks ?? []),
            ...(input.slashSystemExtra?.trim()
              ? [`## Recipe\n${input.slashSystemExtra.trim()}`]
              : []),
            ...(foldPlanMode(input.events)
              ? [DEFAULT_PLAN_POLICY_SECTION]
              : []),
          ],
        }
      : {}),
  });

  // Drop zero-width-only skeleton user on follow-up steps
  const messages = assembled.messages.filter(
    (m) => !(m.role === "user" && m.content === "\u200b"),
  );

  return {
    system: assembled.system,
    messages: [
      { role: "system", content: assembled.system },
      ...messages,
    ],
    tools: assembled.tools,
  };
}

/**
 * Turn driver with optional three-layer assemble on the model request path.
 * Session log remains append-only source of truth; volatile user is ephemeral.
 */
export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const now = input.now ?? Date.now;
  const maxSteps = input.maxSteps ?? 8;
  const turnId = id("turn");
  let assistantText = "";
  let steps = 0;
  let toolOk = 0;
  let toolFailed = 0;
  const compaction = resolveCompactionOptions(input.compaction);
  let overflowRecovered = false;

  let userText = input.userText;
  let userContent: MessageContent = input.userContent ?? input.userText;
  let slashSystemExtra: string | undefined;
  if (input.assemble?.resolveSlash) {
    const resolved = await input.assemble.resolveSlash(userText);
    if (resolved) {
      userText = resolved.userPrompt;
      if (typeof userContent === "string") {
        userContent = userText;
      }
      if (resolved.systemExtra?.trim()) {
        slashSystemExtra = resolved.systemExtra;
      }
    }
  }

  if (contentHasImage(userContent) && !llmAllowsImage(input.llm)) {
    throw new UnsupportedContentError(
      "image content is not supported on text-only LLM routes",
    );
  }

  // Fail-before-retry: settle abandoned tools from a prior crash/abort so the
  // model never sees open tool_calls without results (and we never replay side effects).
  const prior = settleDanglingTools(input.store, input.sessionId, { now });
  toolFailed += prior.settled.length;

  append(input.store, input.sessionId, {
    type: "turn/start",
    ts: now(),
    turnId,
  });
  append(input.store, input.sessionId, {
    type: "user/message",
    ts: now(),
    turnId,
    content: userContent,
  });

  let activeStepId: string | undefined;
  /** Sticky: once any step hits max-tokens, the turn ends that way (DSH). */
  let turnEndReason: TurnEndReason = { kind: "completed" };

  try {
  while (steps < maxSteps) {
    if (input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    steps += 1;
    commitPendingPlanMode(input.store, input.sessionId, now);
    const stepId = id("step");
    activeStepId = stepId;
    append(input.store, input.sessionId, {
      type: "step/start",
      ts: now(),
      turnId,
      stepId,
    });

    const isLastStep = steps >= maxSteps;
    if (isLastStep) {
      append(input.store, input.sessionId, {
        type: "user/message",
        ts: now(),
        turnId,
        content: MAX_STEPS_PROMPT,
      });
    }
    const table = isLastStep ? undefined : materializeTools(input.tools);

    const buildReq = () =>
      buildModelRequest({
        events: input.store.get(input.sessionId).events,
        sessionId: input.sessionId,
        ...(input.system !== undefined ? { system: input.system } : {}),
        ...(input.assemble ? { assemble: input.assemble } : {}),
        tools: table ?? { list: () => [] },
        nowIso: new Date(now()).toISOString(),
        firstStep: steps === 1,
        userText,
        ...(slashSystemExtra !== undefined
          ? { slashSystemExtra }
          : {}),
      });

    let req = buildReq();

    // Soft budget: prune only under pressure (DSH: below-pressure never prune),
    // remeasure, then summarize only if still over.
    if (
      compaction?.auto !== false &&
      compaction?.maxRequestTokens !== undefined
    ) {
      const buffer =
        compaction.bufferTokens ?? DEFAULT_COMPACTION_BUFFER_TOKENS;
      const softCeiling = compaction.maxRequestTokens - buffer;
      let used = estimateMessagesTokens(req.messages);
      if (used > softCeiling) {
        const pruned = pruneOversizedToolResults(input.store, input.sessionId, {
          now,
          turnId,
          stepId,
        });
        if (pruned.pruned > 0) {
          req = buildReq();
          used = estimateMessagesTokens(req.messages);
        }
        if (used > softCeiling) {
          const did = await runCompaction({
            store: input.store,
            sessionId: input.sessionId,
            llm: input.llm,
            reason: "auto",
            keepTokens: compaction.keepTokens ?? DEFAULT_COMPACTION_KEEP_TOKENS,
            turnId,
            ...(input.signal ? { signal: input.signal } : {}),
            now,
          });
          if (did.compacted) req = buildReq();
        }
      }
    }

    // Legacy invariant: logged history reconstructible (excluding ephemeral volatile).
    const snapEvents = input.store.get(input.sessionId).events;
    assertToolCallsSettled(snapEvents);
    assertModelVisible(snapEvents, deriveMessages(snapEvents));

    maybeAppendRequestHeader({
      store: input.store,
      sessionId: input.sessionId,
      turnId,
      llm: input.llm,
      now,
      ...(req.system?.trim() ? { system: req.system } : {}),
      ...(req.tools.length ? { tools: req.tools } : {}),
    });

    let response;
    const onChunk = (chunk: {
      kind: "text" | "reasoning" | "usage" | "tool-call";
      index: number;
      text: string;
      usage?: TokenUsage;
      toolCallId?: string;
      toolName?: string;
      argumentsDelta?: string;
    }) => {
      if (chunk.kind === "usage" && chunk.usage) {
        append(input.store, input.sessionId, {
          type: "assistant/chunk",
          ts: now(),
          turnId,
          stepId,
          text: "",
          kind: "usage",
          usage: chunk.usage,
        });
        return;
      }
      if (chunk.kind === "tool-call" && chunk.toolCallId) {
        const delta = chunk.argumentsDelta ?? chunk.text;
        append(input.store, input.sessionId, {
          type: "assistant/chunk",
          ts: now(),
          turnId,
          stepId,
          text: delta,
          kind: "tool-call",
          index: chunk.index,
          toolCallId: chunk.toolCallId,
          ...(chunk.toolName ? { toolName: chunk.toolName } : {}),
          argumentsDelta: delta,
        });
        return;
      }
      append(input.store, input.sessionId, {
        type: "assistant/chunk",
        ts: now(),
        turnId,
        stepId,
        text: chunk.text,
        kind: chunk.kind === "reasoning" ? "reasoning" : "text",
        index: chunk.index,
      });
    };
    try {
      response = await invokeLlmWithRetry({
        invoke: (onBuffered) => invokeLlm(input, req, onBuffered),
        flushChunk: onChunk,
        store: input.store,
        sessionId: input.sessionId,
        turnId,
        stepId,
        now,
        ...(input.signal ? { signal: input.signal } : {}),
        policy: resolveRetryPolicy(input.llmRetry),
        provider: input.llm.id,
      });
    } catch (err) {
      if (
        compaction &&
        isContextOverflowError(err) &&
        !overflowRecovered
      ) {
        overflowRecovered = true;
        // Overflow: prune first, retry once; only summarize if still overflowing
        // (DSH compaction-basic: model-free prune before head reduction).
        const pruned = pruneOversizedToolResults(input.store, input.sessionId, {
          now,
          turnId,
          stepId,
        });
        if (pruned.pruned > 0) {
          req = buildReq();
          assertToolCallsSettled(input.store.get(input.sessionId).events);
          maybeAppendRequestHeader({
            store: input.store,
            sessionId: input.sessionId,
            turnId,
            llm: input.llm,
            now,
            reason: "change",
            ...(req.system?.trim() ? { system: req.system } : {}),
            ...(req.tools.length ? { tools: req.tools } : {}),
          });
          try {
            response = await invokeLlm(input, req, onChunk);
          } catch (retryErr) {
            if (!isContextOverflowError(retryErr)) throw retryErr;
            const did = await runCompaction({
              store: input.store,
              sessionId: input.sessionId,
              llm: input.llm,
              reason: "overflow",
              keepTokens:
                compaction.keepTokens ?? DEFAULT_COMPACTION_KEEP_TOKENS,
              turnId,
              ...(input.signal ? { signal: input.signal } : {}),
              now,
            });
            if (!did.compacted) throw retryErr;
            req = buildReq();
            assertToolCallsSettled(input.store.get(input.sessionId).events);
            maybeAppendRequestHeader({
              store: input.store,
              sessionId: input.sessionId,
              turnId,
              llm: input.llm,
              now,
              reason: "change",
              ...(req.system?.trim() ? { system: req.system } : {}),
              ...(req.tools.length ? { tools: req.tools } : {}),
            });
            response = await invokeLlm(input, req, onChunk);
          }
        } else {
          const did = await runCompaction({
            store: input.store,
            sessionId: input.sessionId,
            llm: input.llm,
            reason: "overflow",
            keepTokens:
              compaction.keepTokens ?? DEFAULT_COMPACTION_KEEP_TOKENS,
            turnId,
            ...(input.signal ? { signal: input.signal } : {}),
            now,
          });
          if (!did.compacted) throw err;
          req = buildReq();
          assertToolCallsSettled(input.store.get(input.sessionId).events);
          maybeAppendRequestHeader({
            store: input.store,
            sessionId: input.sessionId,
            turnId,
            llm: input.llm,
            now,
            reason: "change",
            ...(req.system?.trim() ? { system: req.system } : {}),
            ...(req.tools.length ? { tools: req.tools } : {}),
          });
          response = await invokeLlm(input, req, onChunk);
        }
      } else {
        throw err;
      }
    }

    assistantText = response.content;
    // DSH: max-tokens is sticky for the turn; keep/drop already stripped tools.
    if (response.finishReason === "max-tokens") {
      turnEndReason = { kind: "max-tokens" };
    }
    append(input.store, input.sessionId, {
      type: "assistant/message",
      ts: now(),
      turnId,
      stepId,
      content: response.content,
      ...(response.toolCalls ? { toolCalls: response.toolCalls } : {}),
      ...(response.reasoning ? { reasoning: response.reasoning } : {}),
      ...(response.usage ? { usage: response.usage } : {}),
    });

    const calls = response.toolCalls ?? [];
    if (calls.length === 0) {
      append(input.store, input.sessionId, {
        type: "step/end",
        ts: now(),
        turnId,
        stepId,
      });
      break;
    }

    if (isLastStep) {
      for (const call of calls) {
        append(input.store, input.sessionId, {
          type: "tool/call",
          ts: now(),
          turnId,
          stepId,
          call,
        });
        append(input.store, input.sessionId, {
          type: "tool/result",
          ts: now(),
          turnId,
          stepId,
          result: {
            toolCallId: call.id,
            name: call.name,
            content: MAX_STEPS_TOOL_DISABLED,
            isError: true,
          },
        });
        toolFailed += 1;
      }
      append(input.store, input.sessionId, {
        type: "step/end",
        ts: now(),
        turnId,
        stepId,
      });
      break;
    }

    const batchContexts: string[] = [];
    const batchSafety: SafetyNoticePayload[] = [];

    // Barrier 1: durable tool/call for every call before any body runs.
    for (const call of calls) {
      if (input.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      append(input.store, input.sessionId, {
        type: "tool/call",
        ts: now(),
        turnId,
        stepId,
        call,
      });
    }

    const { outcomes, aborted: settleAborted } = await settleToolBatch({
      calls,
      registry: input.tools,
      materialization: table!,
      mode: input.toolSettle ?? "parallel",
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.pipeline ? { pipeline: input.pipeline } : {}),
      ...(input.maxParallelToolCalls !== undefined
        ? { maxParallel: input.maxParallelToolCalls }
        : {}),
    });

    // Barrier 2: tool side-events then tool/result in call order.
    for (let i = 0; i < calls.length; i++) {
      const outcome = outcomes[i]!;
      for (const te of outcome.toolEvents) {
        if (te.type !== "todo/write" && te.type !== "plan/mode") continue;
        try {
          const ev = parseSessionEvent({
            type: te.type,
            ts: now(),
            ...(te.payload && typeof te.payload === "object"
              ? te.payload
              : {}),
          });
          append(input.store, input.sessionId, ev);
        } catch {
          // Invalid side payload — skip; tool/result still settles.
        }
      }
      append(input.store, input.sessionId, {
        type: "tool/result",
        ts: now(),
        turnId,
        stepId,
        result: outcome.result,
      });
      if (outcome.result.isError) toolFailed += 1;
      else toolOk += 1;
      batchContexts.push(...outcome.additionalContexts);
      batchSafety.push(...outcome.safetyNotices);
    }

    if (settleAborted || input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    for (const notice of batchSafety) {
      append(input.store, input.sessionId, {
        type: "safety/notice",
        ts: now(),
        turnId,
        kind: notice.kind,
        content: notice.content,
        ...(notice.toolName !== undefined ? { toolName: notice.toolName } : {}),
        ...(notice.count !== undefined ? { count: notice.count } : {}),
      });
    }

    for (const content of batchContexts) {
      append(input.store, input.sessionId, {
        type: "user/message",
        ts: now(),
        turnId,
        content,
      });
    }

    append(input.store, input.sessionId, {
      type: "step/end",
      ts: now(),
      turnId,
      stepId,
    });
    activeStepId = undefined;

    // DSH: any successful tool with concludesTurn ends the turn at this step.
    if (outcomes.some((o) => o.concludesTurn === true)) {
      break;
    }
  }

  append(input.store, input.sessionId, {
    type: "turn/end",
    ts: now(),
    turnId,
    reason: turnEndReason,
  });

  return { turnId, assistantText, steps, toolOk, toolFailed };
  } catch (err) {
    if (isAbortError(err, input.signal)) {
      finalizeCancelledTurn({
        store: input.store,
        sessionId: input.sessionId,
        turnId,
        ...(activeStepId !== undefined ? { stepId: activeStepId } : {}),
        now,
        cancelCause: parseTurnEndCancelCause(input.signal?.reason),
      });
    } else if (
      isEmptyResponseError(err) ||
      isProviderFinishError(err) ||
      isIncompleteToolCallError(err) ||
      isUnsupportedReasoningEffortError(err) ||
      isLlmError(err)
    ) {
      if (activeStepId !== undefined) {
        append(input.store, input.sessionId, {
          type: "step/end",
          ts: now(),
          turnId,
          stepId: activeStepId,
        });
      }
      const code =
        isProviderFinishError(err) ||
        isEmptyResponseError(err) ||
        isIncompleteToolCallError(err) ||
        isUnsupportedReasoningEffortError(err) ||
        isLlmError(err)
          ? (err as { code: string }).code
          : "ERROR";
      append(input.store, input.sessionId, {
        type: "turn/end",
        ts: now(),
        turnId,
        reason: {
          kind: "error",
          error: {
            message: err instanceof Error ? err.message : String(err),
            code,
          },
        },
      });
    }
    throw err;
  }
}

export { MAX_STEPS_PROMPT, MAX_STEPS_TOOL_DISABLED } from "./max-steps.js";
export {
  settleToolBatch,
  type SettleToolBatchInput,
  type SettleToolBatchResult,
  type ToolSettleMode,
} from "./settle-batch.js";
export {
  runCompaction,
  type RunCompactionInput,
  type RunCompactionResult,
} from "./compaction.js";
export { maybeAppendRequestHeader } from "./request-header-log.js";
