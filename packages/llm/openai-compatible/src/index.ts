import {
  offloadRequestImages,
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
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
import type {
  ChatMessage,
  MessageContent,
  ToolCall,
} from "@xrkseek/protocol";
import {
  asContentBlocks,
  contentHasImage,
  flattenText,
  tryParseOpenAiUsage,
} from "@xrkseek/protocol";

export type OpenAiAuthMode = "bearer" | "api-key" | "header";

export interface OpenAiCompatibleOptions {
  readonly id?: string;
  /** e.g. https://api.openai.com/v1 or a gateway base (no trailing slash required). */
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  /** Default `/chat/completions`. */
  readonly path?: string;
  readonly authMode?: OpenAiAuthMode;
  /** When authMode is `header`. */
  readonly authHeaderName?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Extra headers merged after auth. */
  readonly headers?: Record<string, string>;
  /** Inject for tests; default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /**
   * When true (default), expose `stream()` for SSE text/reasoning deltas.
   * Set false to keep chat()-only adapters.
   */
  readonly enableStream?: boolean;
  /** Declared modalities; default `["text"]`. Include `"image"` for vision wire. */
  readonly inputModalities?: readonly ("text" | "image")[];
  /** Max inlined base64 image bytes per request (DSH rc.8 default 20MiB). */
  readonly maxRequestImageBytes?: number;
}

type WireContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | WireContentPart[] }
  | {
      role: "assistant";
      content: string;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | {
      role: "tool";
      content: string | WireContentPart[];
      tool_call_id: string;
      name?: string;
    };

const REASONING_INDEX = 0;
const TEXT_INDEX = 1;

function buildEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) throw new Error("openai-compatible: baseUrl required");
  return `${base}${p}`;
}

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

async function userContentToWire(
  content: MessageContent,
  resolveImage: LlmChatRequest["resolveImage"],
): Promise<string | WireContentPart[]> {
  if (typeof content === "string") return content;
  if (!contentHasImage(content)) return flattenText(content);
  if (!resolveImage) {
    throw new UnsupportedContentError(
      "image content requires resolveImage on the LLM request",
    );
  }
  const parts: WireContentPart[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type === "text") {
      if (block.text) parts.push({ type: "text", text: block.text });
      continue;
    }
    const stored = await resolveImage(block.attachment.attachmentId);
    const b64 = bytesToBase64(stored.data);
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${stored.mediaType};base64,${b64}`,
      },
    });
  }
  return parts.length ? parts : "";
}

async function toWireMessages(
  messages: readonly ChatMessage[],
  resolveImage: LlmChatRequest["resolveImage"],
): Promise<WireMessage[]> {
  const out: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
      continue;
    }
    if (m.role === "user") {
      out.push({
        role: "user",
        content: await userContentToWire(m.content, resolveImage),
      });
      continue;
    }
    if (m.role === "assistant") {
      const tool_calls = m.toolCalls?.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: {
          name: c.name,
          arguments:
            typeof c.arguments === "string"
              ? c.arguments
              : JSON.stringify(c.arguments ?? {}),
        },
      }));
      out.push({
        role: "assistant",
        content: m.content,
        ...(tool_calls?.length ? { tool_calls } : {}),
      });
      continue;
    }
    out.push({
      role: "tool",
      content: await userContentToWire(m.content, resolveImage),
      tool_call_id: m.toolCallId,
      ...(m.name ? { name: m.name } : {}),
    });
  }
  return out;
}

function toWireTools(
  tools: LlmChatRequest["tools"],
):
  | {
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }[]
  | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _raw: raw };
  }
}

function parseToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: ToolCall[] = [];
  raw.forEach((tc, index) => {
    if (!tc || typeof tc !== "object") return;
    const o = tc as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const name =
      typeof o.function?.name === "string" ? o.function.name : "unknown";
    const id =
      typeof o.id === "string" && o.id
        ? o.id
        : `call_${index}_${name.replace(/\W/g, "_")}`;
    calls.push({
      id,
      name,
      arguments: parseArguments(o.function?.arguments),
    });
  });
  return calls.length ? calls : undefined;
}

function looksLikeOverflow(status: number, bodyText: string): boolean {
  if (status !== 400 && status !== 413) return false;
  const t = bodyText.toLowerCase();
  return (
    t.includes("context_length") ||
    t.includes("context length") ||
    t.includes("maximum context") ||
    t.includes("token limit") ||
    t.includes("too many tokens") ||
    t.includes("prompt is too long")
  );
}

/** 413 / payload-too-large that is about request body or images, not context window. */
function looksLikeRequestBodyLimit(status: number, bodyText: string): boolean {
  if (status !== 413) return false;
  if (looksLikeOverflow(status, bodyText)) return false;
  const t = bodyText.toLowerCase();
  return (
    t.includes("payload") ||
    t.includes("request entity") ||
    t.includes("request body") ||
    t.includes("content too large") ||
    t.includes("entity too large") ||
    t.includes("image") ||
    t.includes("file size") ||
    t.includes("too large") ||
    t.trim() === ""
  );
}

function buildAuthHeaders(
  options: OpenAiCompatibleOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const key = options.apiKey?.trim();
  if (!key) {
    return { ...headers, ...options.headers };
  }
  const mode = options.authMode ?? "bearer";
  if (mode === "api-key") {
    headers["api-key"] = key;
  } else if (mode === "header") {
    const name = options.authHeaderName?.trim();
    if (!name) {
      throw new Error(
        "openai-compatible: authMode=header requires authHeaderName",
      );
    }
    headers[name] = key;
  } else {
    headers.authorization = `Bearer ${key}`;
  }
  return { ...headers, ...options.headers };
}

function requestSignal(
  options: OpenAiCompatibleOptions,
  request: LlmChatRequest,
): AbortSignal | undefined {
  const timeoutMs = options.timeoutMs;
  const timeoutSignal =
    timeoutMs !== undefined && timeoutMs > 0
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  if (request.signal && timeoutSignal) {
    return AbortSignal.any([request.signal, timeoutSignal]);
  }
  return request.signal ?? timeoutSignal;
}

async function buildBody(
  options: OpenAiCompatibleOptions,
  request: LlmChatRequest,
  stream: boolean,
): Promise<Record<string, unknown>> {
  const modalities = options.inputModalities ?? ["text"];
  for (const m of request.messages) {
    if (
      (m.role === "user" || m.role === "tool") &&
      contentHasImage(m.content)
    ) {
      if (!modalities.includes("image")) {
        throw new UnsupportedContentError(
          "image content is not supported on text-only LLM routes",
        );
      }
    }
  }
  const maxImageBytes =
    options.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES;
  const bounded = offloadRequestImages(request.messages, maxImageBytes);
  const body: Record<string, unknown> = {
    model: options.model,
    messages: await toWireMessages(bounded, request.resolveImage),
    stream,
  };
  const tools = toWireTools(request.tools);
  if (tools) body.tools = tools;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

function parseChatJson(text: string): LlmChatResponse {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(
      `openai-compatible: invalid JSON response: ${text.slice(0, 200)}`,
      { cause: err },
    );
  }
  const root = json as { choices?: unknown[]; usage?: unknown };
  const choice = root?.choices?.[0] as
    | {
        message?: {
          content?: unknown;
          tool_calls?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
        };
      }
    | undefined;
  const message = choice?.message;
  const content =
    typeof message?.content === "string" ? message.content : "";
  const toolCalls = parseToolCalls(message?.tool_calls);
  const reasoningRaw =
    typeof message?.reasoning_content === "string"
      ? message.reasoning_content
      : typeof message?.reasoning === "string"
        ? message.reasoning
        : undefined;
  const reasoning =
    reasoningRaw && reasoningRaw.trim() ? reasoningRaw : undefined;
  const usage = tryParseOpenAiUsage(root.usage);
  return {
    content,
    ...(toolCalls ? { toolCalls } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(usage ? { usage } : {}),
  };
}

type ToolCallAcc = {
  id?: string;
  name?: string;
  arguments: string;
};

async function* streamSse(
  res: Response,
): AsyncGenerator<LlmStreamEvent> {
  if (!res.body) {
    throw new Error("openai-compatible: empty stream body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoning = "";
  let usage: LlmChatResponse["usage"];
  const toolAcc = new Map<number, ToolCallAcc>();

  const flushLine = function* (line: string): Generator<LlmStreamEvent> {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (data === "[DONE]") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const root = json as { choices?: unknown[]; usage?: unknown };
    const parsedUsage = tryParseOpenAiUsage(root.usage);
    if (parsedUsage) {
      usage = parsedUsage;
      yield { type: "usage", usage: parsedUsage };
    }
    const choice = root?.choices?.[0] as
      | {
          delta?: {
            content?: unknown;
            reasoning_content?: unknown;
            reasoning?: unknown;
            tool_calls?: unknown;
          };
        }
      | undefined;
    const delta = choice?.delta;
    if (!delta) return;

    const reasonPiece =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : "";
    if (reasonPiece) {
      reasoning += reasonPiece;
      yield {
        type: "reasoning-delta",
        index: REASONING_INDEX,
        text: reasonPiece,
      };
    }
    const textPiece =
      typeof delta.content === "string" ? delta.content : "";
    if (textPiece) {
      content += textPiece;
      yield { type: "text-delta", index: TEXT_INDEX, text: textPiece };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        if (!raw || typeof raw !== "object") continue;
        const tc = raw as {
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        };
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const cur = toolAcc.get(idx) ?? { arguments: "" };
        if (typeof tc.id === "string") cur.id = tc.id;
        if (typeof tc.function?.name === "string") cur.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") {
          cur.arguments += tc.function.arguments;
        }
        toolAcc.set(idx, cur);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      yield* flushLine(line);
    }
  }
  if (buf.trim()) yield* flushLine(buf);

  const toolCalls: ToolCall[] = [];
  for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
    const name = acc.name ?? "unknown";
    toolCalls.push({
      id: acc.id ?? `call_${idx}_${name.replace(/\W/g, "_")}`,
      name,
      arguments: parseArguments(acc.arguments),
    });
  }

  yield {
    type: "done",
    content,
    ...(reasoning.trim() ? { reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
  };
}

/**
 * OpenAI Chat Completions adapter with optional SSE stream + vision parts.
 */
export function createOpenAiCompatibleAdapter(
  options: OpenAiCompatibleOptions,
): LlmAdapter {
  const id = options.id ?? "openai-compatible";
  const endpoint = buildEndpoint(
    options.baseUrl,
    options.path ?? "/chat/completions",
  );
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const enableStream = options.enableStream !== false;
  const inputModalities = options.inputModalities ?? ["text"];

  async function post(
    request: LlmChatRequest,
    stream: boolean,
  ): Promise<Response> {
    if (request.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const body = await buildBody(options, request, stream);
    const signal = requestSignal(options, request);
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: buildAuthHeaders(options),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      if (looksLikeOverflow(res.status, text)) {
        throw new ContextOverflowError(
          `openai-compatible overflow (${res.status}): ${text.slice(0, 400)}`,
        );
      }
      if (looksLikeRequestBodyLimit(res.status, text)) {
        throw new UnsupportedContentError(
          `openai-compatible request body too large (${res.status}): ${text.slice(0, 400)}`,
        );
      }
      throw new Error(
        `openai-compatible HTTP ${res.status}: ${text.slice(0, 800)}`,
      );
    }
    return res;
  }

  const adapter: LlmAdapter = {
    id,
    inputModalities,
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      const res = await post(request, false);
      const text = await res.text();
      return parseChatJson(text);
    },
  };

  if (enableStream) {
    adapter.stream = async function* (
      request: LlmChatRequest,
    ): AsyncIterable<LlmStreamEvent> {
      const res = await post(request, true);
      yield* streamSse(res);
    };
  }

  return adapter;
}

export { buildEndpoint as buildOpenAiCompatibleEndpoint };
export { collectLlmStream };
