import {
  assertModelVisible,
  assertToolCallsSettled,
  deriveMessages,
  estimateMessagesTokens,
  settleDanglingTools,
  DEFAULT_COMPACTION_BUFFER_TOKENS,
  DEFAULT_COMPACTION_KEEP_TOKENS,
  type CompactionOptions,
  type SessionStore,
} from "@xrkseek/core-session";
import {
  assembleThreeLayers,
  buildVolatileUser,
  type AssembledRequest,
} from "@xrkseek/core-system-prompt";
import {
  materializeTools,
  type ToolPipeline,
  type ToolRegistry,
} from "@xrkseek/core-tools";
import {
  isContextOverflowError,
  UnsupportedContentError,
  type LlmAdapter,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@xrkseek/llm";
import type {
  ChatMessage,
  MessageContent,
  SafetyNoticePayload,
  SessionEvent,
} from "@xrkseek/protocol";
import { contentHasImage, flattenText } from "@xrkseek/protocol";
import { resolveCompactionOptions, runCompaction } from "./compaction.js";
import {
  MAX_STEPS_PROMPT,
  MAX_STEPS_TOOL_DISABLED,
} from "./max-steps.js";
import { settleToolBatch, type ToolSettleMode } from "./settle-batch.js";

export interface AssembleOptions {
  readonly persona?: string;
  readonly mcpProtocol?: string;
  readonly owner?: string;
  readonly workspaceBlocks?: readonly string[];
  /** When false, skip three-layer and use legacy system+history. Default true if assemble set. */
  readonly enabled?: boolean;
  /**
   * Expand `/recipe-id …` before the user message is logged.
   * Return undefined to keep raw text. Typically wired to workspace `tryApplySlashRecipe`.
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
   * Context compaction / overflow recovery (opt-in).
   * Pass `false` or omit to disable. Object enables auto + one overflow retry.
   */
  readonly compaction?: false | CompactionOptions;
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

function llmAllowsImage(llm: LlmAdapter): boolean {
  return (llm.inputModalities ?? ["text"]).includes("image");
}

function toLlmRequest(
  input: RunTurnInput,
  req: { messages: ChatMessage[]; tools: AssembledRequest["tools"] },
): LlmChatRequest {
  return {
    messages: req.messages,
    ...(req.tools.length ? { tools: req.tools } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.resolveImage ? { resolveImage: input.resolveImage } : {}),
  };
}

async function invokeLlm(
  input: RunTurnInput,
  req: { messages: ChatMessage[]; tools: AssembledRequest["tools"] },
  onChunk: (chunk: {
    kind: "text" | "reasoning";
    index: number;
    text: string;
  }) => void,
): Promise<LlmChatResponse> {
  const request = toLlmRequest(input, req);
  if (!input.llm.stream) {
    return input.llm.chat(request);
  }
  let content = "";
  let reasoning = "";
  let toolCalls: LlmChatResponse["toolCalls"];
  for await (const ev of input.llm.stream(request)) {
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
    } else if (ev.type === "done") {
      content = ev.content || content;
      if (ev.reasoning) reasoning = ev.reasoning;
      if (ev.toolCalls) toolCalls = ev.toolCalls;
    }
  }
  return {
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls ? { toolCalls } : {}),
  };
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

  const toolDefs = input.tools.list().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const useAssemble = input.assemble && input.assemble.enabled !== false;
  if (!useAssemble) {
    const messages: ChatMessage[] = [];
    if (input.system) messages.push({ role: "system", content: input.system });
    messages.push(...derived);
    return {
      ...(input.system !== undefined ? { system: input.system } : {}),
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
    tools: toolDefs,
    ...(input.assemble?.workspaceBlocks || input.slashSystemExtra
      ? {
          workspaceBlocks: [
            ...(input.assemble?.workspaceBlocks ?? []),
            ...(input.slashSystemExtra?.trim()
              ? [`## Recipe\n${input.slashSystemExtra.trim()}`]
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

  while (steps < maxSteps) {
    if (input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    steps += 1;
    const stepId = id("step");
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

    // Proactive compact when soft budget exceeded.
    if (
      compaction?.auto !== false &&
      compaction?.maxRequestTokens !== undefined
    ) {
      const buffer =
        compaction.bufferTokens ?? DEFAULT_COMPACTION_BUFFER_TOKENS;
      const used = estimateMessagesTokens(req.messages);
      if (used > compaction.maxRequestTokens - buffer) {
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

    // Legacy invariant: logged history reconstructible (excluding ephemeral volatile).
    const snapEvents = input.store.get(input.sessionId).events;
    assertToolCallsSettled(snapEvents);
    assertModelVisible(snapEvents, deriveMessages(snapEvents));

    let response;
    const onChunk = (chunk: {
      kind: "text" | "reasoning";
      index: number;
      text: string;
    }) => {
      append(input.store, input.sessionId, {
        type: "assistant/chunk",
        ts: now(),
        turnId,
        stepId,
        text: chunk.text,
        kind: chunk.kind,
        index: chunk.index,
      });
    };
    try {
      response = await invokeLlm(input, req, onChunk);
    } catch (err) {
      if (
        compaction &&
        isContextOverflowError(err) &&
        !overflowRecovered
      ) {
        overflowRecovered = true;
        const did = await runCompaction({
          store: input.store,
          sessionId: input.sessionId,
          llm: input.llm,
          reason: "overflow",
          keepTokens: compaction.keepTokens ?? DEFAULT_COMPACTION_KEEP_TOKENS,
          turnId,
          ...(input.signal ? { signal: input.signal } : {}),
          now,
        });
        if (!did.compacted) throw err;
        req = buildReq();
        assertToolCallsSettled(input.store.get(input.sessionId).events);
        response = await invokeLlm(input, req, onChunk);
      } else {
        throw err;
      }
    }

    assistantText = response.content;
    append(input.store, input.sessionId, {
      type: "assistant/message",
      ts: now(),
      turnId,
      stepId,
      content: response.content,
      ...(response.toolCalls ? { toolCalls: response.toolCalls } : {}),
      ...(response.reasoning ? { reasoning: response.reasoning } : {}),
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

    const { outcomes } = await settleToolBatch({
      calls,
      registry: input.tools,
      materialization: table!,
      mode: input.toolSettle ?? "parallel",
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.pipeline ? { pipeline: input.pipeline } : {}),
    });

    // Barrier 2: tool/result in call order (not completion order).
    for (let i = 0; i < calls.length; i++) {
      const outcome = outcomes[i]!;
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
  }

  append(input.store, input.sessionId, {
    type: "turn/end",
    ts: now(),
    turnId,
  });

  return { turnId, assistantText, steps, toolOk, toolFailed };
}

export { buildVolatileUser };
export { MAX_STEPS_PROMPT, MAX_STEPS_TOOL_DISABLED } from "./max-steps.js";
export {
  settleToolBatch,
  type SettleToolBatchInput,
  type SettleToolBatchResult,
  type ToolSettleMode,
} from "./settle-batch.js";
export {
  runCompaction,
  resolveCompactionOptions,
  type RunCompactionInput,
  type RunCompactionResult,
} from "./compaction.js";
