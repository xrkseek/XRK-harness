/**
 * W3C Trace Context helpers for outbound LLM / OTLP requests.
 * One turn shares a single trace-id; spans get fresh span-ids.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export interface W3cTraceContext {
  readonly version: "00";
  readonly traceId: string;
  readonly spanId: string;
  readonly flags: string;
  readonly tracestate?: string;
}

const store = new AsyncLocalStorage<W3cTraceContext>();

const HEX_TRACE = /^[0-9a-f]{32}$/i;
const HEX_SPAN = /^[0-9a-f]{16}$/i;

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** Parse a `traceparent` header (W3C version 00). Invalid → undefined. */
export function parseTraceparent(raw: string | undefined): W3cTraceContext | undefined {
  if (!raw) return undefined;
  const parts = raw.trim().split("-");
  if (parts.length !== 4) return undefined;
  const [version, traceId, spanId, flags] = parts;
  if (version !== "00") return undefined;
  if (!traceId || !HEX_TRACE.test(traceId) || /^0+$/.test(traceId)) return undefined;
  if (!spanId || !HEX_SPAN.test(spanId) || /^0+$/.test(spanId)) return undefined;
  if (!flags || !/^[0-9a-f]{2}$/i.test(flags)) return undefined;
  return {
    version: "00",
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    flags: flags.toLowerCase(),
  };
}

export function formatTraceparent(ctx: W3cTraceContext): string {
  return `${ctx.version}-${ctx.traceId}-${ctx.spanId}-${ctx.flags}`;
}

/** Fresh root context, or continue an upstream parent with a new span id. */
export function createTraceContext(
  parent?: W3cTraceContext,
  options?: { readonly tracestate?: string },
): W3cTraceContext {
  return {
    version: "00",
    traceId: parent?.traceId ?? randomHex(16),
    spanId: randomHex(8),
    flags: parent?.flags ?? "01",
    ...(options?.tracestate !== undefined
      ? { tracestate: options.tracestate }
      : parent?.tracestate !== undefined
        ? { tracestate: parent.tracestate }
        : {}),
  };
}

/**
 * Inherit from `TRACEPARENT` / `TRACESTATE` env when present; otherwise mint a
 * new root. Used at turn start so every outbound call shares one trace-id.
 */
export function resolveTurnTraceContext(
  env: NodeJS.ProcessEnv = process.env,
): W3cTraceContext {
  const parent = parseTraceparent(env.TRACEPARENT ?? env.traceparent);
  const tracestate = (env.TRACESTATE ?? env.tracestate)?.trim() || undefined;
  return createTraceContext(parent, tracestate ? { tracestate } : undefined);
}

export function getActiveTraceContext(): W3cTraceContext | undefined {
  return store.getStore();
}

/** Run `fn` with `ctx` as the active outbound trace (AsyncLocalStorage). */
export function runWithTraceContext<T>(
  ctx: W3cTraceContext,
  fn: () => T,
): T {
  return store.run(ctx, fn);
}

/**
 * Merge `traceparent` / `tracestate` into outbound headers when a turn context
 * is active. Does not overwrite an explicit caller-supplied traceparent.
 */
export function mergeOutboundTraceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const ctx = getActiveTraceContext();
  if (!ctx) return headers;
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (lower.traceparent) return headers;
  const next: Record<string, string> = {
    ...headers,
    traceparent: formatTraceparent(ctx),
  };
  if (ctx.tracestate && !lower.tracestate) {
    next.tracestate = ctx.tracestate;
  }
  return next;
}
