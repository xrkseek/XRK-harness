import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  offloadRequestImages,
} from "@xrkseek/attachment";
import type {
  LlmAdapter,
  LlmChatRequest,
  LlmChatResponse,
  LlmStreamEvent,
} from "@xrkseek/llm";
import {
  collectLlmStream,
  ContextOverflowError,
  UnsupportedContentError,
} from "@xrkseek/llm";
import type { ChatMessage, MessageContent, ToolCall } from "@xrkseek/protocol";
import {
  asContentBlocks,
  contentHasImage,
  flattenText,
} from "@xrkseek/protocol";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514";
export const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicAdapterOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly path?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly enableStream?: boolean;
  readonly inputModalities?: readonly ("text" | "image")[];
  readonly maxRequestImageBytes?: number;
  readonly anthropicVersion?: string;
}

type AnthContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AnthMessage = { role: "user" | "assistant"; content: string | AnthContent[] };

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function looksLikeOverflow(status: number, text: string): boolean {
  const t = text.toLowerCase();
  return (
    status === 400 &&
    (t.includes("context") ||
      t.includes("too long") ||
      t.includes("max_tokens") ||
      t.includes("prompt is too long"))
  );
}

async function userParts(
  content: MessageContent,
  resolveImage: LlmChatRequest["resolveImage"],
  modalities: readonly ("text" | "image")[],
): Promise<AnthContent[]> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!contentHasImage(content)) {
    return [{ type: "text", text: flattenText(content) }];
  }
  if (!modalities.includes("image")) {
    throw new UnsupportedContentError(
      "image content is not supported on text-only Anthropic routes",
    );
  }
  if (!resolveImage) {
    throw new UnsupportedContentError(
      "image content requires resolveImage on the LLM request",
    );
  }
  const parts: AnthContent[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type === "text") {
      if (block.text) parts.push({ type: "text", text: block.text });
      continue;
    }
    const stored = await resolveImage(block.attachment.attachmentId);
    parts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: stored.mediaType,
        data: bytesToBase64(stored.data),
      },
    });
  }
  return parts;
}

async function toAnthMessages(
  messages: readonly ChatMessage[],
  resolveImage: LlmChatRequest["resolveImage"],
  modalities: readonly ("text" | "image")[],
): Promise<{ system?: string; messages: AnthMessage[] }> {
  let system: string | undefined;
  const out: AnthMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = flattenText(m.content);
      system = system ? `${system}\n${text}` : text;
      continue;
    }
    if (m.role === "user") {
      out.push({
        role: "user",
        content: await userParts(m.content, resolveImage, modalities),
      });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: AnthContent[] = [];
      const text = flattenText(m.content);
      if (text) blocks.push({ type: "text", text });
      if (m.toolCalls?.length) {
        for (const call of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : "" });
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: flattenText(m.content),
            ...(m.isError ? { is_error: true } : {}),
          },
        ],
      });
    }
  }
  return { ...(system ? { system } : {}), messages: out };
}

function parseResponse(json: unknown): LlmChatResponse {
  const contentBlocks = (json as { content?: unknown })?.content;
  let content = "";
  let reasoning = "";
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(contentBlocks)) {
    for (const raw of contentBlocks) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as {
        type?: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: unknown;
      };
      if (block.type === "text" && typeof block.text === "string") {
        content += block.text;
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        reasoning += block.thinking;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: typeof block.id === "string" ? block.id : `tool_${toolCalls.length}`,
          name: typeof block.name === "string" ? block.name : "unknown",
          arguments:
            block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : {},
        });
      }
    }
  }
  return {
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

async function* streamAnthropicSse(res: Response): AsyncGenerator<LlmStreamEvent> {
  if (!res.body) throw new Error("anthropic: empty stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoning = "";
  const toolAcc = new Map<number, { id?: string; name?: string; json: string }>();
  let blockIndex = -1;
  let blockType = "";

  const flushEvent = function* (payload: string): Generator<LlmStreamEvent> {
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const ev = json as {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
      };
    };
    if (ev.type === "content_block_start") {
      blockIndex = typeof ev.index === "number" ? ev.index : blockIndex + 1;
      blockType = ev.content_block?.type ?? "";
      if (blockType === "tool_use") {
        const id = ev.content_block?.id;
        const name = ev.content_block?.name;
        toolAcc.set(blockIndex, {
          ...(id !== undefined ? { id } : {}),
          ...(name !== undefined ? { name } : {}),
          json: "",
        });
      }
      return;
    }
    if (ev.type === "content_block_delta") {
      const delta = ev.delta;
      if (!delta) return;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        content += delta.text;
        yield { type: "text-delta", index: 1, text: delta.text };
      } else if (
        delta.type === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        reasoning += delta.thinking;
        yield { type: "reasoning-delta", index: 0, text: delta.thinking };
      } else if (
        delta.type === "input_json_delta" &&
        typeof delta.partial_json === "string"
      ) {
        const cur = toolAcc.get(
          typeof ev.index === "number" ? ev.index : blockIndex,
        ) ?? { json: "" };
        cur.json += delta.partial_json;
        toolAcc.set(typeof ev.index === "number" ? ev.index : blockIndex, cur);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        yield* flushEvent(trimmed.slice(5).trim());
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
    let args: Record<string, unknown> = {};
    try {
      args = acc.json ? (JSON.parse(acc.json) as Record<string, unknown>) : {};
    } catch {
      args = { _raw: acc.json };
    }
    toolCalls.push({
      id: acc.id ?? `tool_${idx}`,
      name: acc.name ?? "unknown",
      arguments: args,
    });
  }
  yield {
    type: "done",
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

/**
 * Anthropic Messages API adapter (`anthropic-messages` protocol).
 */
export function createAnthropicAdapter(
  options: AnthropicAdapterOptions,
): LlmAdapter {
  const id = options.id ?? "anthropic";
  const baseUrl = (options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const path = options.path ?? "/v1/messages";
  const endpoint = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const enableStream = options.enableStream !== false;
  const modalities = options.inputModalities ?? ["text", "image"];
  const maxTokens = options.maxTokens ?? 8192;

  async function post(
    request: LlmChatRequest,
    stream: boolean,
  ): Promise<Response> {
    if (request.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const maxImageBytes =
      options.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES;
    const bounded = offloadRequestImages(request.messages, maxImageBytes);
    const { system, messages } = await toAnthMessages(
      bounded,
      request.resolveImage,
      modalities,
    );
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages,
      stream,
    };
    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": options.anthropicVersion ?? ANTHROPIC_API_VERSION,
      ...options.headers,
    };
    const key = options.apiKey?.trim();
    if (key) headers["x-api-key"] = key;

    const timeoutSignal =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;
    const signal =
      request.signal && timeoutSignal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : (request.signal ?? timeoutSignal);

    const res = await doFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      if (looksLikeOverflow(res.status, text)) {
        throw new ContextOverflowError(
          `anthropic overflow (${res.status}): ${text.slice(0, 400)}`,
        );
      }
      throw new Error(`anthropic HTTP ${res.status}: ${text.slice(0, 800)}`);
    }
    return res;
  }

  const adapter: LlmAdapter = {
    id,
    inputModalities: modalities,
    async chat(request) {
      if (enableStream && !request.signal?.aborted) {
        // Prefer non-stream JSON for chat() when stream is optional.
      }
      const res = await post(request, false);
      return parseResponse(JSON.parse(await res.text()));
    },
  };

  if (enableStream) {
    adapter.stream = async function* (request) {
      const res = await post(request, true);
      yield* streamAnthropicSse(res);
    };
    // Keep chat() as one-shot JSON (compaction / replay paths).
  }

  return adapter;
}

export async function anthropicChatViaStream(
  adapter: LlmAdapter,
  request: LlmChatRequest,
): Promise<LlmChatResponse> {
  if (!adapter.stream) return adapter.chat(request);
  return collectLlmStream(adapter.stream(request));
}
