/**
 * Minimal streamable-HTTP MCP client for Parallel Search free endpoint.
 * Ported (slimmed) from XRK-AGT web-search-mcp-client — no SDK dependency.
 */

import { randomUUID } from "node:crypto";
import type { FetchFn } from "./types.js";
import { WebError } from "./types.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function iterMcpMessages(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const emit = (payload: unknown) => {
    if (Array.isArray(payload)) {
      for (const entry of payload) {
        if (isRecord(entry)) out.push(entry);
      }
    } else if (isRecord(payload)) {
      out.push(payload);
    }
  };

  const body = text.trim();
  if (!body) return out;
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      emit(JSON.parse(body) as unknown);
    } catch {
      /* non-json */
    }
    return out;
  }

  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    try {
      emit(JSON.parse(dataLines.join("\n")) as unknown);
    } catch {
      /* skip */
    }
    dataLines = [];
  };

  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return out;
}

export function selectMcpEnvelope(
  text: string,
  requestId: string,
): Record<string, unknown> {
  let fallback: Record<string, unknown> = {};
  for (const msg of iterMcpMessages(text)) {
    if (!("result" in msg || "error" in msg)) continue;
    if (msg.id === requestId) return msg;
    fallback = msg;
  }
  return fallback;
}

export function extractMcpToolPayload(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  if ("error" in envelope) {
    throw new WebError(
      `MCP error: ${JSON.stringify(envelope.error).slice(0, 500)}`,
      "WEB_PROVIDER_ERROR",
    );
  }
  const result = isRecord(envelope.result) ? envelope.result : {};
  if (result.isError) {
    throw new WebError(
      `MCP tool error: ${JSON.stringify(result).slice(0, 500)}`,
      "WEB_PROVIDER_ERROR",
    );
  }
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text
    ) {
      try {
        const parsed = JSON.parse(block.text) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        /* next */
      }
    }
  }
  throw new WebError(
    `MCP returned no parseable content: ${JSON.stringify(result).slice(0, 500)}`,
    "WEB_PROVIDER_ERROR",
  );
}

async function postMcp(
  fetchFn: FetchFn,
  url: string,
  params: {
    readonly body: unknown;
    readonly sessionId?: string;
    readonly protocolVersion?: string;
    readonly signal?: AbortSignal;
  },
): Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
  readonly sessionIdHeader: string | null;
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (params.sessionId) headers["Mcp-Session-Id"] = params.sessionId;
  if (params.protocolVersion) {
    headers["MCP-Protocol-Version"] = params.protocolVersion;
  }
  const response = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params.body),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
    sessionIdHeader: response.headers.get("mcp-session-id"),
  };
}

/**
 * MCP initialize → notifications/initialized → tools/call.
 */
export async function callMcpTool(params: {
  readonly url: string;
  readonly toolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly fetch?: FetchFn;
  readonly signal?: AbortSignal;
  readonly clientName?: string;
  readonly clientVersion?: string;
}): Promise<Record<string, unknown>> {
  const fetchFn = params.fetch ?? globalThis.fetch;
  const clientName = params.clientName ?? "xrk-harness";
  const clientVersion = params.clientVersion ?? "0.0.0";

  const initId = randomUUID();
  const init = await postMcp(fetchFn, params.url, {
    body: {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: clientName, version: clientVersion },
      },
    },
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (!init.ok) {
    throw new WebError(
      `MCP initialize failed (${init.status}): ${init.text.slice(0, 300)}`,
      "WEB_PROVIDER_ERROR",
    );
  }

  const sessionId = init.sessionIdHeader ?? undefined;
  const initEnvelope = selectMcpEnvelope(init.text, initId);
  const negotiatedVersion =
    (isRecord(initEnvelope.result) &&
    typeof initEnvelope.result.protocolVersion === "string"
      ? initEnvelope.result.protocolVersion
      : undefined) ?? MCP_PROTOCOL_VERSION;

  await postMcp(fetchFn, params.url, {
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
    ...(sessionId ? { sessionId } : {}),
    protocolVersion: negotiatedVersion,
    ...(params.signal ? { signal: params.signal } : {}),
  });

  const callId = randomUUID();
  const call = await postMcp(fetchFn, params.url, {
    body: {
      jsonrpc: "2.0",
      id: callId,
      method: "tools/call",
      params: { name: params.toolName, arguments: params.toolArgs },
    },
    ...(sessionId ? { sessionId } : {}),
    protocolVersion: negotiatedVersion,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (!call.ok) {
    throw new WebError(
      `MCP tools/call failed (${call.status}): ${call.text.slice(0, 300)}`,
      "WEB_PROVIDER_ERROR",
    );
  }
  return extractMcpToolPayload(selectMcpEnvelope(call.text, callId));
}
