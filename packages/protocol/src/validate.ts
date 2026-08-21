import type {
  CompactionReason,
  SafetyNoticeKind,
  SessionEvent,
} from "./session-events.js";
import { isPromptDelivery } from "./session-events.js";
import type { ToolCall, ToolResult } from "./tools.js";
import {
  isContentBlock,
  type MessageContent,
} from "./content.js";
import { parseTokenUsage } from "./token-usage.js";

const SAFETY_KINDS = new Set([
  "loop_soft",
  "loop_hard",
  "mistake_limit",
  "api_error",
]);

const COMPACTION_REASONS = new Set(["auto", "overflow", "manual"]);

export class SessionEventParseError extends Error {
  constructor(
    message: string,
    readonly path: string = "",
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "SessionEventParseError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reqString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new SessionEventParseError(`expected string "${key}"`, path);
  }
  return v;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new SessionEventParseError(`expected string "${key}"`);
  }
  return v;
}

function optNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SessionEventParseError(`expected number "${key}"`);
  }
  return v;
}

function parseToolCall(value: unknown, path: string): ToolCall {
  if (!isObject(value)) {
    throw new SessionEventParseError("expected tool call object", path);
  }
  return {
    id: reqString(value, "id", path),
    name: reqString(value, "name", path),
    arguments: value.arguments,
  };
}

function parseToolResult(value: unknown, path: string): ToolResult {
  if (!isObject(value)) {
    throw new SessionEventParseError("expected tool result object", path);
  }
  const isError = value.isError;
  if (isError !== undefined && typeof isError !== "boolean") {
    throw new SessionEventParseError("isError must be boolean", path);
  }
  const meta = value.meta;
  if (meta !== undefined) {
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
      throw new SessionEventParseError("meta must be a JSON object", path);
    }
  }
  let error: ToolResult["error"];
  const errorRaw = value.error;
  if (errorRaw !== undefined) {
    if (!isObject(errorRaw)) {
      throw new SessionEventParseError("error must be an object", path);
    }
    error = {
      name: reqString(errorRaw, "name", `${path}.error`),
      code: reqString(errorRaw, "code", `${path}.error`),
    };
  }
  return {
    toolCallId: reqString(value, "toolCallId", path),
    name: reqString(value, "name", path),
    content: parseMessageContent(value.content, `${path}.content`),
    ...(isError === true ? { isError: true as const } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(meta !== undefined
      ? { meta: meta as Readonly<Record<string, unknown>> }
      : {}),
  };
}

function parseToolCalls(
  value: unknown,
  path: string,
): readonly ToolCall[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new SessionEventParseError("toolCalls must be array", path);
  }
  return value.map((c, i) => parseToolCall(c, `${path}[${i}]`));
}

function parseMessageContent(value: unknown, path: string): MessageContent {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new SessionEventParseError(
      "content must be string or ContentBlock[]",
      path,
    );
  }
  const blocks = value.map((block, i) => {
    if (!isContentBlock(block)) {
      throw new SessionEventParseError("invalid ContentBlock", `${path}[${i}]`);
    }
    return block;
  });
  return blocks;
}

/**
 * Strict parse of an unknown value into a `SessionEvent`.
 * Prefer this over the loose type-only `isSessionEvent` for I/O boundaries.
 */
export function parseSessionEvent(value: unknown): SessionEvent {
  if (!isObject(value)) {
    throw new SessionEventParseError("expected object");
  }
  const type = value.type;
  if (typeof type !== "string") {
    throw new SessionEventParseError("expected string type");
  }
  const ts = value.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    throw new SessionEventParseError("expected finite number ts");
  }

  switch (type) {
    case "turn/start":
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
      };
    case "turn/end": {
      const reasonRaw = value.reason;
      if (!isObject(reasonRaw) || typeof reasonRaw.kind !== "string") {
        throw new SessionEventParseError("reason must be an object with kind", type);
      }
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        reason: reasonRaw as import("./session-events.js").TurnEndReason,
      };
    }
    case "step/start":
    case "step/end":
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
      };
    case "user/message": {
      const rpcId = optString(value, "rpcId");
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        content: parseMessageContent(value.content, `${type}.content`),
        ...(rpcId !== undefined ? { rpcId } : {}),
      };
    }
    case "assistant/chunk": {
      const kindRaw = value.kind;
      const kind =
        kindRaw === "reasoning" ||
        kindRaw === "text" ||
        kindRaw === "usage" ||
        kindRaw === "tool-call"
          ? kindRaw
          : undefined;
      const index =
        typeof value.index === "number" && Number.isFinite(value.index)
          ? Math.floor(value.index)
          : undefined;
      const usage =
        value.usage === undefined
          ? undefined
          : (() => {
              try {
                return parseTokenUsage(value.usage);
              } catch (err) {
                throw new SessionEventParseError(
                  err instanceof Error ? err.message : "invalid usage",
                  `${type}.usage`,
                );
              }
            })();
      if (kind === "usage" && usage === undefined) {
        throw new SessionEventParseError(
          'kind "usage" requires usage object',
          type,
        );
      }
      const toolCallId = optString(value, "toolCallId");
      const toolName = optString(value, "toolName");
      const argumentsDelta = optString(value, "argumentsDelta");
      if (kind === "tool-call") {
        if (!toolCallId) {
          throw new SessionEventParseError(
            'kind "tool-call" requires toolCallId',
            type,
          );
        }
        const delta =
          argumentsDelta ??
          (typeof value.text === "string" ? value.text : "");
        return {
          type,
          ts,
          turnId: reqString(value, "turnId", type),
          stepId: reqString(value, "stepId", type),
          text: delta,
          kind: "tool-call" as const,
          ...(index !== undefined ? { index } : {}),
          toolCallId,
          ...(toolName !== undefined ? { toolName } : {}),
          argumentsDelta: delta,
        };
      }
      const text =
        kind === "usage"
          ? typeof value.text === "string"
            ? value.text
            : ""
          : reqString(value, "text", type);
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
        text,
        ...(kind ? { kind } : {}),
        ...(index !== undefined ? { index } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
    }
    case "assistant/message": {
      const toolCalls = parseToolCalls(value.toolCalls, `${type}.toolCalls`);
      const reasoning = optString(value, "reasoning");
      const interrupted =
        value.interrupted === undefined
          ? undefined
          : value.interrupted === true
            ? true
            : (() => {
                throw new SessionEventParseError(
                  'expected boolean "interrupted"',
                  type,
                );
              })();
      const usage =
        value.usage === undefined
          ? undefined
          : (() => {
              try {
                return parseTokenUsage(value.usage);
              } catch (err) {
                throw new SessionEventParseError(
                  err instanceof Error ? err.message : "invalid usage",
                  `${type}.usage`,
                );
              }
            })();
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
        content: reqString(value, "content", type),
        ...(toolCalls ? { toolCalls } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(interrupted !== undefined ? { interrupted } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
    }
    case "tool/call":
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
        call: parseToolCall(value.call, `${type}.call`),
      };
    case "tool/result":
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
        result: parseToolResult(value.result, `${type}.result`),
      };
    case "prompt/admitted": {
      const delivery = value.delivery;
      if (delivery !== undefined && !isPromptDelivery(delivery)) {
        throw new SessionEventParseError(
          'delivery must be "steer" | "queue"',
          type,
        );
      }
      return {
        type,
        ts,
        admitId: reqString(value, "admitId", type),
        content: parseMessageContent(value.content, `${type}.content`),
        ...(delivery === "steer" ? { delivery: "steer" as const } : {}),
        // persist queue explicitly if client sent it
        ...(delivery === "queue" ? { delivery: "queue" as const } : {}),
      };
    }
    case "prompt/promoted":
      return {
        type,
        ts,
        admitId: reqString(value, "admitId", type),
      };
    case "prompt/withdrawn":
      return {
        type,
        ts,
        admitId: reqString(value, "admitId", type),
      };
    case "safety/notice": {
      const kind = reqString(value, "kind", type);
      if (!SAFETY_KINDS.has(kind)) {
        throw new SessionEventParseError(`unknown safety kind "${kind}"`, type);
      }
      const toolName = optString(value, "toolName");
      const count = optNumber(value, "count");
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        kind: kind as SafetyNoticeKind,
        content: reqString(value, "content", type),
        ...(toolName !== undefined ? { toolName } : {}),
        ...(count !== undefined ? { count } : {}),
      };
    }
    case "context/compaction": {
      const reason = reqString(value, "reason", type);
      if (!COMPACTION_REASONS.has(reason)) {
        throw new SessionEventParseError(
          `unknown compaction reason "${reason}"`,
          type,
        );
      }
      const turnId = optString(value, "turnId");
      const shadowedRaw = value.shadowedTokenCount;
      let shadowedTokenCount: number | undefined;
      if (shadowedRaw !== undefined) {
        if (
          typeof shadowedRaw !== "number" ||
          !Number.isInteger(shadowedRaw) ||
          shadowedRaw < 0
        ) {
          throw new SessionEventParseError(
            "shadowedTokenCount must be a non-negative integer",
            `${type}.shadowedTokenCount`,
          );
        }
        shadowedTokenCount = shadowedRaw;
      }
      return {
        type,
        ts,
        reason: reason as CompactionReason,
        summary: reqString(value, "summary", type),
        recent: reqString(value, "recent", type),
        ...(turnId !== undefined ? { turnId } : {}),
        ...(shadowedTokenCount !== undefined ? { shadowedTokenCount } : {}),
      };
    }
    case "session/title": {
      const sourceRaw = value.source;
      if (
        sourceRaw === null ||
        typeof sourceRaw !== "object" ||
        !("kind" in sourceRaw)
      ) {
        throw new SessionEventParseError("source.kind required", type);
      }
      const kind = Reflect.get(sourceRaw, "kind");
      if (kind !== "fallback" && kind !== "user") {
        throw new SessionEventParseError(
          'source.kind must be "fallback" | "user"',
          type,
        );
      }
      const messageSeqs = Reflect.get(value, "messageSeqs");
      let seqs: readonly number[] | undefined;
      if (messageSeqs !== undefined) {
        if (
          !Array.isArray(messageSeqs) ||
          !messageSeqs.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          throw new SessionEventParseError(
            "messageSeqs must be number[]",
            type,
          );
        }
        seqs = messageSeqs as number[];
      }
      return {
        type,
        ts,
        title: reqString(value, "title", type),
        source: { kind },
        ...(seqs !== undefined ? { messageSeqs: seqs } : {}),
      };
    }
    case "approval/asked": {
      const argsSummary = optString(value, "argsSummary");
      const turnId = optString(value, "turnId");
      const stepId = optString(value, "stepId");
      return {
        type,
        ts,
        approvalId: reqString(value, "approvalId", type),
        toolCallId: reqString(value, "toolCallId", type),
        toolName: reqString(value, "toolName", type),
        reason: reqString(value, "reason", type),
        ...(argsSummary !== undefined ? { argsSummary } : {}),
        ...(turnId !== undefined ? { turnId } : {}),
        ...(stepId !== undefined ? { stepId } : {}),
      };
    }
    case "approval/decided": {
      const decisionRaw = reqString(value, "decision", type);
      if (decisionRaw !== "allow" && decisionRaw !== "deny") {
        throw new SessionEventParseError(
          'decision must be "allow" | "deny"',
          type,
        );
      }
      const sourceRaw = reqString(value, "source", type);
      if (
        sourceRaw !== "user" &&
        sourceRaw !== "cancel" &&
        sourceRaw !== "timeout"
      ) {
        throw new SessionEventParseError(
          'source must be "user" | "cancel" | "timeout"',
          type,
        );
      }
      return {
        type,
        ts,
        approvalId: reqString(value, "approvalId", type),
        decision: decisionRaw,
        source: sourceRaw,
      };
    }
    case "command/run": {
      const args = optString(value, "args");
      const sourceRaw = value.source;
      if (
        sourceRaw === null ||
        typeof sourceRaw !== "object" ||
        !("kind" in sourceRaw) ||
        Reflect.get(sourceRaw, "kind") !== "user"
      ) {
        throw new SessionEventParseError('source.kind must be "user"', type);
      }
      return {
        type,
        ts,
        commandId: reqString(value, "commandId", type),
        name: reqString(value, "name", type),
        source: { kind: "user" },
        ...(args !== undefined ? { args } : {}),
      };
    }
    case "command/done": {
      const kindRaw = reqString(value, "kind", type);
      if (kindRaw !== "success" && kindRaw !== "error") {
        throw new SessionEventParseError(
          'kind must be "success" | "error"',
          type,
        );
      }
      const text = optString(value, "text");
      const sourceEventSeq = optNumber(value, "sourceEventSeq");
      return {
        type,
        ts,
        commandId: reqString(value, "commandId", type),
        kind: kindRaw,
        ...(text !== undefined ? { text } : {}),
        ...(sourceEventSeq !== undefined ? { sourceEventSeq } : {}),
      };
    }
    case "todo/write": {
      const todosRaw = value.todos;
      if (!Array.isArray(todosRaw)) {
        throw new SessionEventParseError("todos must be array", type);
      }
      const todos: {
        content: string;
        status: "pending" | "in_progress" | "completed";
      }[] = [];
      for (let i = 0; i < todosRaw.length; i++) {
        const row = todosRaw[i];
        if (row === null || typeof row !== "object") {
          throw new SessionEventParseError("invalid todo item", `${type}[${i}]`);
        }
        const content = Reflect.get(row, "content");
        const status = Reflect.get(row, "status");
        if (typeof content !== "string" || !content.trim()) {
          throw new SessionEventParseError(
            "todo.content must be non-empty string",
            `${type}[${i}]`,
          );
        }
        if (
          status !== "pending" &&
          status !== "in_progress" &&
          status !== "completed"
        ) {
          throw new SessionEventParseError(
            'todo.status must be "pending" | "in_progress" | "completed"',
            `${type}[${i}]`,
          );
        }
        todos.push({ content: content.trim(), status });
      }
      return { type, ts, todos };
    }
    case "permission/preset":
      return {
        type,
        ts,
        preset: reqString(value, "preset", type),
      };
    case "sandbox/mode": {
      const mode = reqString(value, "mode", type);
      if (
        mode !== "read-only" &&
        mode !== "workspace-write" &&
        mode !== "danger-full-access"
      ) {
        throw new SessionEventParseError(
          'mode must be "read-only" | "workspace-write" | "danger-full-access"',
          type,
        );
      }
      return { type, ts, mode };
    }
    case "approval/policy": {
      const policy = reqString(value, "policy", type);
      if (policy !== "ask" && policy !== "never") {
        throw new SessionEventParseError(
          'policy must be "ask" | "never"',
          type,
        );
      }
      return { type, ts, policy };
    }
    case "plan/mode": {
      const active = value.active;
      if (typeof active !== "boolean") {
        throw new SessionEventParseError("active must be boolean", type);
      }
      return { type, ts, active };
    }
    case "feedback/record": {
      const text = reqString(value, "text", type);
      if (!text.trim()) {
        throw new SessionEventParseError("text must be non-empty", type);
      }
      return { type, ts, text };
    }
    case "request/header": {
      const reasonRaw = value.reason;
      const reason =
        reasonRaw === "initial" ||
        reasonRaw === "resume" ||
        reasonRaw === "change"
          ? reasonRaw
          : undefined;
      if (!reason) {
        throw new SessionEventParseError("invalid request/header reason", type);
      }
      const headerRaw = value.header;
      if (!headerRaw || typeof headerRaw !== "object" || Array.isArray(headerRaw)) {
        throw new SessionEventParseError("header required", type);
      }
      const configRaw = (headerRaw as { config?: unknown }).config;
      if (!configRaw || typeof configRaw !== "object" || Array.isArray(configRaw)) {
        throw new SessionEventParseError("header.config required", type);
      }
      const configRecord = configRaw as Record<string, unknown>;
      const provider = reqString(configRecord, "provider", `${type}.config`);
      const model = reqString(configRecord, "model", `${type}.config`);
      const reasoningEffort = optString(configRecord, "reasoningEffort");
      const contextWindowRaw = configRecord.contextWindow;
      const contextWindow =
        typeof contextWindowRaw === "number" &&
        Number.isInteger(contextWindowRaw) &&
        contextWindowRaw > 0
          ? contextWindowRaw
          : undefined;
      const systemRaw = (headerRaw as { system?: unknown }).system;
      const system =
        typeof systemRaw === "string" && systemRaw.length > 0
          ? systemRaw
          : undefined;
      const toolsRaw = (headerRaw as { tools?: unknown }).tools;
      let tools:
        | {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          }[]
        | undefined;
      if (Array.isArray(toolsRaw)) {
        tools = [];
        for (const row of toolsRaw) {
          if (!row || typeof row !== "object") continue;
          const r = row as Record<string, unknown>;
          const name = typeof r.name === "string" ? r.name.trim() : "";
          if (!name) continue;
          const description =
            typeof r.description === "string" ? r.description : "";
          const parameters =
            r.parameters &&
            typeof r.parameters === "object" &&
            !Array.isArray(r.parameters)
              ? (r.parameters as Record<string, unknown>)
              : {};
          tools.push({ name, description, parameters });
        }
        if (tools.length === 0) tools = undefined;
      }
      const adapterDefaultsRaw = (headerRaw as { adapterDefaults?: unknown })
        .adapterDefaults;
      let adapterDefaults:
        | { reasoningEffort?: boolean; maxTokens?: boolean }
        | undefined;
      if (
        adapterDefaultsRaw !== undefined &&
        typeof adapterDefaultsRaw === "object" &&
        !Array.isArray(adapterDefaultsRaw)
      ) {
        adapterDefaults = {};
        const re = (adapterDefaultsRaw as { reasoningEffort?: unknown })
          .reasoningEffort;
        const mt = (adapterDefaultsRaw as { maxTokens?: unknown }).maxTokens;
        if (re === true) adapterDefaults.reasoningEffort = true;
        if (mt === true) adapterDefaults.maxTokens = true;
        if (Object.keys(adapterDefaults).length === 0) adapterDefaults = undefined;
      }
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        reason,
        header: {
          config: {
            provider,
            model,
            ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
            ...(contextWindow !== undefined ? { contextWindow } : {}),
          },
          ...(system !== undefined ? { system } : {}),
          ...(tools !== undefined ? { tools } : {}),
          ...(adapterDefaults ? { adapterDefaults } : {}),
        },
      };
    }
    case "llm/retry": {
      const modeRaw = value.mode;
      const mode =
        modeRaw === "normal" || modeRaw === "always" ? modeRaw : undefined;
      if (!mode) {
        throw new SessionEventParseError("invalid llm/retry mode", type);
      }
      const failureRaw = value.failure;
      if (
        !failureRaw ||
        typeof failureRaw !== "object" ||
        Array.isArray(failureRaw)
      ) {
        throw new SessionEventParseError("failure required", type);
      }
      const f = failureRaw as Record<string, unknown>;
      const delayMs = value.delayMs;
      if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
        throw new SessionEventParseError("delayMs must be a non-negative number", type);
      }
      const retry = value.retry;
      if (typeof retry !== "number" || !Number.isInteger(retry) || retry < 1) {
        throw new SessionEventParseError("retry must be a positive integer", type);
      }
      const maxRetriesRaw = value.maxRetries;
      const maxRetries =
        typeof maxRetriesRaw === "number" &&
        Number.isInteger(maxRetriesRaw) &&
        maxRetriesRaw >= 0
          ? maxRetriesRaw
          : undefined;
      const statusRaw = f.status;
      const status =
        typeof statusRaw === "number" && Number.isInteger(statusRaw)
          ? statusRaw
          : undefined;
      const pra = f.providerRetryAfterMs;
      const providerRetryAfterMs =
        typeof pra === "number" && Number.isFinite(pra) && pra >= 0
          ? pra
          : undefined;
      const provider = optString(value, "provider");
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
        retryId: reqString(value, "retryId", type),
        retry,
        ...(maxRetries !== undefined ? { maxRetries } : {}),
        delayMs,
        mode,
        failure: {
          message: reqString(f, "message", `${type}.failure`),
          code: reqString(f, "code", `${type}.failure`),
          ...(status !== undefined ? { status } : {}),
          ...(providerRetryAfterMs !== undefined
            ? { providerRetryAfterMs }
            : {}),
        },
        ...(provider !== undefined ? { provider } : {}),
      };
    }
    case "llm/retry-started": {
      const retry = value.retry;
      if (typeof retry !== "number" || !Number.isInteger(retry) || retry < 1) {
        throw new SessionEventParseError("retry must be a positive integer", type);
      }
      return {
        type,
        ts,
        turnId: reqString(value, "turnId", type),
        stepId: reqString(value, "stepId", type),
        retryId: reqString(value, "retryId", type),
        retry,
      };
    }
    default:
      throw new SessionEventParseError(`unknown event type "${type}"`);
  }
}

/** Throw `SessionEventParseError` if invalid; return typed event. */
export function assertSessionEvent(value: unknown): SessionEvent {
  return parseSessionEvent(value);
}

/** Soft check — true iff `parseSessionEvent` succeeds. */
export function isValidSessionEvent(value: unknown): value is SessionEvent {
  try {
    parseSessionEvent(value);
    return true;
  } catch {
    return false;
  }
}
