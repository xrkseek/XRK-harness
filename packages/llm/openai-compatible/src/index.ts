import type {
  LlmAdapter,
  LlmChatRequest,
  LlmChatResponse,
} from "@xrkseek/llm";
import { ContextOverflowError } from "@xrkseek/llm";
import type { ChatMessage, ToolCall } from "@xrkseek/protocol";

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
}

type WireMessage =
  | { role: "system" | "user"; content: string }
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
      content: string;
      tool_call_id: string;
      name?: string;
    };

function buildEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) throw new Error("openai-compatible: baseUrl required");
  return `${base}${p}`;
}

function toWireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      out.push({ role: m.role, content: m.content });
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
    // tool
    out.push({
      role: "tool",
      content: m.content,
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

/**
 * Thin OpenAI Chat Completions adapter (non-streaming).
 * Essence: endpoint join, bearer/api-key auth,
 * tools as function schema, tool_calls normalize — no vision/SSE/proxy yet.
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

  return {
    id,
    async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
      if (request.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }

      const body: Record<string, unknown> = {
        model: options.model,
        messages: toWireMessages(request.messages),
        stream: false,
      };
      const tools = toWireTools(request.tools);
      if (tools) body.tools = tools;
      if (options.temperature !== undefined) {
        body.temperature = options.temperature;
      }
      if (options.maxTokens !== undefined) {
        body.max_tokens = options.maxTokens;
      }

      const timeoutMs = options.timeoutMs;
      const timeoutSignal =
        timeoutMs !== undefined && timeoutMs > 0
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
      const signal =
        request.signal && timeoutSignal
          ? AbortSignal.any([request.signal, timeoutSignal])
          : (request.signal ?? timeoutSignal);

      const res = await doFetch(endpoint, {
        method: "POST",
        headers: buildAuthHeaders(options),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });

      const text = await res.text();
      if (!res.ok) {
        if (looksLikeOverflow(res.status, text)) {
          throw new ContextOverflowError(
            `openai-compatible overflow (${res.status}): ${text.slice(0, 400)}`,
          );
        }
        throw new Error(
          `openai-compatible HTTP ${res.status}: ${text.slice(0, 800)}`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch (err) {
        throw new Error(
          `openai-compatible: invalid JSON response: ${text.slice(0, 200)}`,
          { cause: err },
        );
      }

      const choice = (json as { choices?: unknown[] })?.choices?.[0] as
        | {
            message?: {
              content?: unknown;
              tool_calls?: unknown;
            };
          }
        | undefined;
      const message = choice?.message;
      const content =
        typeof message?.content === "string" ? message.content : "";
      const toolCalls = parseToolCalls(message?.tool_calls);

      return {
        content,
        ...(toolCalls ? { toolCalls } : {}),
      };
    },
  };
}

export { buildEndpoint as buildOpenAiCompatibleEndpoint };
