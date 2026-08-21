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
  ContextOverflowError,
  classifyCaughtLlmError,
  isLlmError,
  throwHttpLlmError,
  UnsupportedContentError,
} from "@xrkseek/llm";
import type { ChatMessage, MessageContent, ToolCall } from "@xrkseek/protocol";
import {
  asContentBlocks,
  contentHasImage,
  flattenText,
} from "@xrkseek/protocol";

export const OPENAI_RESPONSES_DEFAULT_PATH = "/responses";

export interface OpenAiResponsesAdapterOptions {
  readonly id?: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly path?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly enableStream?: boolean;
  readonly inputModalities?: readonly ("text" | "image")[];
  readonly maxRequestImageBytes?: number;
}

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "output_text"; text: string }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

type InputItem =
  | { role: "user" | "assistant" | "system"; content: string | InputPart[] }
  | InputPart;

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function looksLikeOverflow(status: number, text: string): boolean {
  const t = text.toLowerCase();
  return (
    status === 400 &&
    (t.includes("context") || t.includes("too long") || t.includes("overflow"))
  );
}

async function userContent(
  content: MessageContent,
  resolveImage: LlmChatRequest["resolveImage"],
  modalities: readonly ("text" | "image")[],
): Promise<string | InputPart[]> {
  if (typeof content === "string") return content;
  if (!contentHasImage(content)) return flattenText(content);
  if (!modalities.includes("image")) {
    throw new UnsupportedContentError(
      "image content is not supported on text-only Responses routes",
    );
  }
  if (!resolveImage) {
    throw new UnsupportedContentError(
      "image content requires resolveImage on the LLM request",
    );
  }
  const parts: InputPart[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type === "text") {
      if (block.text) parts.push({ type: "input_text", text: block.text });
      continue;
    }
    const stored = await resolveImage(block.attachment.attachmentId);
    parts.push({
      type: "input_image",
      image_url: `data:${stored.mediaType};base64,${bytesToBase64(stored.data)}`,
    });
  }
  return parts;
}

async function toInput(
  messages: readonly ChatMessage[],
  resolveImage: LlmChatRequest["resolveImage"],
  modalities: readonly ("text" | "image")[],
): Promise<InputItem[]> {
  const out: InputItem[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: flattenText(m.content) });
      continue;
    }
    if (m.role === "user") {
      out.push({
        role: "user",
        content: await userContent(m.content, resolveImage, modalities),
      });
      continue;
    }
    if (m.role === "assistant") {
      const parts: InputPart[] = [];
      const text = flattenText(m.content);
      if (text) parts.push({ type: "output_text", text });
      if (m.toolCalls?.length) {
        for (const call of m.toolCalls) {
          parts.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          });
        }
      }
      out.push({
        role: "assistant",
        content: parts.length ? parts : flattenText(m.content),
      });
      continue;
    }
    if (m.role === "tool") {
      out.push({
        type: "function_call_output",
        call_id: m.toolCallId,
        output: flattenText(m.content),
      });
    }
  }
  return out;
}

function parseResponse(json: unknown): LlmChatResponse {
  const output = (json as { output?: unknown })?.output;
  let content = "";
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const row = item as {
        type?: string;
        content?: unknown;
        call_id?: string;
        name?: string;
        arguments?: string;
      };
      if (row.type === "message" && Array.isArray(row.content)) {
        for (const part of row.content) {
          if (!part || typeof part !== "object") continue;
          const p = part as { type?: string; text?: string };
          if (
            (p.type === "output_text" || p.type === "text") &&
            typeof p.text === "string"
          ) {
            content += p.text;
          }
        }
      } else if (row.type === "function_call") {
        let args: Record<string, unknown>;
        try {
          args = row.arguments
            ? (JSON.parse(row.arguments) as Record<string, unknown>)
            : {};
        } catch {
          args = { _raw: row.arguments };
        }
        toolCalls.push({
          id: row.call_id ?? `call_${toolCalls.length}`,
          name: row.name ?? "unknown",
          arguments: args,
        });
      }
    }
  }
  // Fallback: some gateways mirror chat.completions shape
  if (!content && !toolCalls.length) {
    const choice = (json as { choices?: unknown[] })?.choices?.[0] as
      | { message?: { content?: string; tool_calls?: unknown } }
      | undefined;
    if (typeof choice?.message?.content === "string") {
      content = choice.message.content;
    }
  }
  return {
    content,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

async function* streamResponsesSse(
  res: Response,
): AsyncGenerator<LlmStreamEvent> {
  if (!res.body) throw new Error("openai-responses: empty stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolAcc = new Map<string, { name?: string; arguments: string }>();

  const flush = function* (line: string): Generator<LlmStreamEvent> {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const ev = json as {
      type?: string;
      delta?: string | { text?: string };
      item?: {
        type?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
      };
    };
    if (
      ev.type === "response.output_text.delta" ||
      ev.type === "response.text.delta"
    ) {
      const piece =
        typeof ev.delta === "string"
          ? ev.delta
          : typeof ev.delta?.text === "string"
            ? ev.delta.text
            : "";
      if (piece) {
        content += piece;
        yield { type: "text-delta", index: 0, text: piece };
      }
    }
    if (ev.type === "response.output_item.added" && ev.item?.type === "function_call") {
      const name = ev.item.name;
      toolAcc.set(ev.item.call_id ?? `call_${toolAcc.size}`, {
        ...(name !== undefined ? { name } : {}),
        arguments: ev.item.arguments ?? "",
      });
    }
    if (ev.type === "response.function_call_arguments.delta") {
      const id = (json as { item_id?: string }).item_id ?? [...toolAcc.keys()].at(-1);
      if (id && typeof ev.delta === "string") {
        const cur = toolAcc.get(id) ?? { arguments: "" };
        cur.arguments += ev.delta;
        toolAcc.set(id, cur);
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
      yield* flush(line);
    }
  }
  if (buf.trim()) yield* flush(buf);

  const toolCalls: ToolCall[] = [];
  for (const [id, acc] of toolAcc) {
    let args: Record<string, unknown>;
    try {
      args = acc.arguments
        ? (JSON.parse(acc.arguments) as Record<string, unknown>)
        : {};
    } catch {
      args = { _raw: acc.arguments };
    }
    toolCalls.push({
      id,
      name: acc.name ?? "unknown",
      arguments: args,
    });
  }
  yield {
    type: "done",
    content,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

/**
 * OpenAI Responses API adapter (`openai-responses` protocol).
 */
export function createOpenAiResponsesAdapter(
  options: OpenAiResponsesAdapterOptions,
): LlmAdapter {
  const id = options.id ?? "openai-responses";
  const base = options.baseUrl.replace(/\/+$/, "");
  const path = options.path ?? OPENAI_RESPONSES_DEFAULT_PATH;
  const endpoint = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const enableStream = options.enableStream !== false;
  const modalities = options.inputModalities ?? ["text", "image"];

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
    const body: Record<string, unknown> = {
      model: options.model,
      input: await toInput(bounded, request.resolveImage, modalities),
      stream,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    const key = options.apiKey?.trim();
    if (key) headers.authorization = `Bearer ${key}`;

    const timeoutSignal =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;
    const signal =
      request.signal && timeoutSignal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : (request.signal ?? timeoutSignal);

    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (isLlmError(err)) throw err;
      classifyCaughtLlmError(err, "openai-responses");
    }
    if (!res.ok) {
      const text = await res.text();
      if (looksLikeOverflow(res.status, text)) {
        throw new ContextOverflowError(
          `openai-responses overflow (${res.status}): ${text.slice(0, 400)}`,
        );
      }
      throwHttpLlmError("openai-responses", res.status, text, res.headers);
    }
    return res;
  }

  const adapter: LlmAdapter = {
    id,
    inputModalities: modalities,
    async chat(request) {
      const res = await post(request, false);
      return parseResponse(JSON.parse(await res.text()));
    },
  };
  if (enableStream) {
    adapter.stream = async function* (request) {
      const res = await post(request, true);
      yield* streamResponsesSse(res);
    };
  }
  return adapter;
}
