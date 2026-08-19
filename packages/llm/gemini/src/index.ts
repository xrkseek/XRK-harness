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
  UnsupportedContentError,
} from "@xrkseek/llm";
import type { ChatMessage, MessageContent, ToolCall } from "@xrkseek/protocol";
import {
  asContentBlocks,
  contentHasImage,
  flattenText,
} from "@xrkseek/protocol";

export const GEMINI_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

export interface GeminiAdapterOptions {
  readonly id?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly enableStream?: boolean;
  readonly inputModalities?: readonly ("text" | "image")[];
  readonly maxRequestImageBytes?: number;
}

type GemPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | {
      functionCall: {
        name: string;
        args?: Record<string, unknown>;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

type GemContent = { role: "user" | "model"; parts: GemPart[] };

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function looksLikeOverflow(status: number, text: string): boolean {
  const t = text.toLowerCase();
  return (
    (status === 400 || status === 413) &&
    (t.includes("token") || t.includes("too long") || t.includes("quota"))
  );
}

async function userParts(
  content: MessageContent,
  resolveImage: LlmChatRequest["resolveImage"],
  modalities: readonly ("text" | "image")[],
): Promise<GemPart[]> {
  if (typeof content === "string") return [{ text: content }];
  if (!contentHasImage(content)) return [{ text: flattenText(content) }];
  if (!modalities.includes("image")) {
    throw new UnsupportedContentError(
      "image content is not supported on text-only Gemini routes",
    );
  }
  if (!resolveImage) {
    throw new UnsupportedContentError(
      "image content requires resolveImage on the LLM request",
    );
  }
  const parts: GemPart[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type === "text") {
      if (block.text) parts.push({ text: block.text });
      continue;
    }
    const stored = await resolveImage(block.attachment.attachmentId);
    parts.push({
      inlineData: {
        mimeType: stored.mediaType,
        data: bytesToBase64(stored.data),
      },
    });
  }
  return parts;
}

async function toGeminiContents(
  messages: readonly ChatMessage[],
  resolveImage: LlmChatRequest["resolveImage"],
  modalities: readonly ("text" | "image")[],
): Promise<{ systemInstruction?: { parts: GemPart[] }; contents: GemContent[] }> {
  let systemText = "";
  const contents: GemContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemText = systemText
        ? `${systemText}\n${flattenText(m.content)}`
        : flattenText(m.content);
      continue;
    }
    if (m.role === "user") {
      contents.push({
        role: "user",
        parts: await userParts(m.content, resolveImage, modalities),
      });
      continue;
    }
    if (m.role === "assistant") {
      const parts: GemPart[] = [];
      const text = flattenText(m.content);
      if (text) parts.push({ text });
      if (m.toolCalls?.length) {
        for (const call of m.toolCalls) {
          parts.push({
            functionCall: {
              name: call.name,
              args: call.arguments as Record<string, unknown>,
            },
          });
        }
      }
      contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
      continue;
    }
    if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.name ?? "tool",
              response: { result: flattenText(m.content) },
            },
          },
        ],
      });
    }
  }
  return {
    ...(systemText
      ? { systemInstruction: { parts: [{ text: systemText }] } }
      : {}),
    contents,
  };
}

function parseGenerateContent(json: unknown): LlmChatResponse {
  const candidates = (json as { candidates?: unknown[] })?.candidates;
  const first = candidates?.[0] as
    | { content?: { parts?: unknown[] } }
    | undefined;
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const raw of first?.content?.parts ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as {
      text?: string;
      functionCall?: { name?: string; args?: Record<string, unknown> };
    };
    if (typeof part.text === "string") content += part.text;
    if (part.functionCall?.name) {
      toolCalls.push({
        id: `call_${toolCalls.length}_${part.functionCall.name}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  }
  return {
    content,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

async function* streamGeminiJsonLines(
  res: Response,
): AsyncGenerator<LlmStreamEvent> {
  if (!res.body) throw new Error("gemini: empty stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolCalls: ToolCall[] = [];

  const flushObj = function* (obj: unknown): Generator<LlmStreamEvent> {
    const parsed = parseGenerateContent(obj);
    if (parsed.content.startsWith(content)) {
      const delta = parsed.content.slice(content.length);
      if (delta) {
        content = parsed.content;
        yield { type: "text-delta", index: 0, text: delta };
      }
    } else if (parsed.content) {
      content += parsed.content;
      yield { type: "text-delta", index: 0, text: parsed.content };
    }
    if (parsed.toolCalls?.length) {
      for (const call of parsed.toolCalls) {
        if (!toolCalls.some((t) => t.id === call.id && t.name === call.name)) {
          toolCalls.push(call);
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // Gemini streamGenerateContent returns concatenated JSON objects / SSE-ish.
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payload || payload === "[DONE]") continue;
      try {
        yield* flushObj(JSON.parse(payload));
      } catch {
        /* accumulate incomplete */
      }
    }
  }
  if (buf.trim()) {
    try {
      yield* flushObj(JSON.parse(buf.trim()));
    } catch {
      /* ignore trailing junk */
    }
  }
  yield {
    type: "done",
    content,
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

/**
 * Google Gemini generateContent adapter (`gemini-generate` protocol).
 */
export function createGeminiAdapter(
  options: GeminiAdapterOptions = {},
): LlmAdapter {
  const id = options.id ?? "gemini";
  const baseUrl = (options.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const model = options.model ?? GEMINI_DEFAULT_MODEL;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const enableStream = options.enableStream !== false;
  const modalities = options.inputModalities ?? ["text", "image"];

  function endpoint(stream: boolean): string {
    const action = stream ? "streamGenerateContent" : "generateContent";
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:${action}`;
    const key = options.apiKey?.trim();
    if (!key) return url;
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}key=${encodeURIComponent(key)}`;
  }

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
    const shaped = await toGeminiContents(
      bounded,
      request.resolveImage,
      modalities,
    );
    const body: Record<string, unknown> = {
      contents: shaped.contents,
    };
    if (shaped.systemInstruction) {
      body.systemInstruction = shaped.systemInstruction;
    }
    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (Object.keys(generationConfig).length) {
      body.generationConfig = generationConfig;
    }
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }
    if (stream) {
      // alt=sse improves line-oriented parsing on many Gemini endpoints.
      // key is already in URL when present.
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    const timeoutSignal =
      options.timeoutMs !== undefined && options.timeoutMs > 0
        ? AbortSignal.timeout(options.timeoutMs)
        : undefined;
    const signal =
      request.signal && timeoutSignal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : (request.signal ?? timeoutSignal);

    let url = endpoint(stream);
    if (stream && !url.includes("alt=")) {
      url += `${url.includes("?") ? "&" : "?"}alt=sse`;
    }

    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      if (looksLikeOverflow(res.status, text)) {
        throw new ContextOverflowError(
          `gemini overflow (${res.status}): ${text.slice(0, 400)}`,
        );
      }
      throw new Error(`gemini HTTP ${res.status}: ${text.slice(0, 800)}`);
    }
    return res;
  }

  const adapter: LlmAdapter = {
    id,
    inputModalities: modalities,
    async chat(request) {
      const res = await post(request, false);
      return parseGenerateContent(JSON.parse(await res.text()));
    },
  };
  if (enableStream) {
    adapter.stream = async function* (request) {
      const res = await post(request, true);
      yield* streamGeminiJsonLines(res);
    };
  }
  return adapter;
}
