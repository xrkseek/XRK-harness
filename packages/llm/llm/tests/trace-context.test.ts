import { describe, expect, it } from "vitest";
import {
  createTraceContext,
  formatTraceparent,
  getActiveTraceContext,
  mergeOutboundTraceHeaders,
  parseTraceparent,
  resolveTurnTraceContext,
  runWithTraceContext,
} from "../src/trace-context.js";

describe("parseTraceparent / formatTraceparent", () => {
  it("round-trips a valid header", () => {
    const raw =
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ctx = parseTraceparent(raw);
    expect(ctx).toEqual({
      version: "00",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      flags: "01",
    });
    expect(formatTraceparent(ctx!)).toBe(raw);
  });

  it("rejects malformed or all-zero ids", () => {
    expect(parseTraceparent("01-aa-bb-01")).toBeUndefined();
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      ),
    ).toBeUndefined();
    expect(
      parseTraceparent(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
      ),
    ).toBeUndefined();
  });
});

describe("createTraceContext / resolveTurnTraceContext", () => {
  it("continues an upstream TRACEPARENT with a new span id", () => {
    const parent = parseTraceparent(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    )!;
    const child = createTraceContext(parent, { tracestate: "vendor=1" });
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.tracestate).toBe("vendor=1");
  });

  it("inherits TRACEPARENT from env", () => {
    const ctx = resolveTurnTraceContext({
      TRACEPARENT:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      TRACESTATE: "congo=t61rcWkgMzE",
    });
    expect(ctx.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(ctx.tracestate).toBe("congo=t61rcWkgMzE");
  });

  it("mints a fresh root when env is empty", () => {
    const a = resolveTurnTraceContext({});
    const b = resolveTurnTraceContext({});
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.traceId).not.toBe(b.traceId);
  });
});

describe("runWithTraceContext / mergeOutboundTraceHeaders", () => {
  it("injects the active context into outbound headers", async () => {
    const ctx = createTraceContext();
    await runWithTraceContext(ctx, async () => {
      expect(getActiveTraceContext()?.traceId).toBe(ctx.traceId);
      const headers = mergeOutboundTraceHeaders({
        "content-type": "application/json",
      });
      expect(headers.traceparent).toBe(formatTraceparent(ctx));
    });
    expect(getActiveTraceContext()).toBeUndefined();
  });

  it("does not overwrite an explicit traceparent", () => {
    const ctx = createTraceContext();
    runWithTraceContext(ctx, () => {
      const headers = mergeOutboundTraceHeaders({
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00",
      });
      expect(headers.traceparent).toBe(
        "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00",
      );
    });
  });

  it("keeps one trace-id across nested awaits in a turn", async () => {
    const ctx = resolveTurnTraceContext({});
    const ids: string[] = [];
    await runWithTraceContext(ctx, async () => {
      ids.push(getActiveTraceContext()!.traceId);
      await Promise.resolve();
      ids.push(getActiveTraceContext()!.traceId);
      await new Promise((r) => setTimeout(r, 1));
      ids.push(mergeOutboundTraceHeaders({}).traceparent!.split("-")[1]!);
    });
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(ctx.traceId);
  });
});
