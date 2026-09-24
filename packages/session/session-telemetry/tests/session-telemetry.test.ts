import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createDefaultSessionTelemetryAccess,
  createMemorySessionTelemetrySink,
  createOtlpHttpSessionTelemetrySink,
  resolveOtlpLogsEndpoint,
  wrapStoreForSessionTelemetry,
} from "../src/index.js";

describe("session-telemetry", () => {
  it("memory sink captures wrapStore appends", async () => {
    const sink = createMemorySessionTelemetrySink();
    const base = createMemorySessionStore();
    const store = wrapStoreForSessionTelemetry({
      store: base,
      sink,
      sessionId: "s1",
    });
    store.create("s1");
    store.append("s1", { type: "turn/start", ts: 1, turnId: "t1" });
    store.append("s1", {
      type: "turn/end",
      ts: 2,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    // create emits ops; two ledger events
    expect(sink.records.some((r) => r.attributes["telemetry.op"] === "session.created")).toBe(
      true,
    );
    const ledger = sink.records.filter((r) => r.channel === "ledger");
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.attributes["event.type"]).toBe("turn/start");
    expect(ledger[1]!.attributes["event.seq"]).toBe(2);
    await sink.shutdown();
  });

  it("OTLP sink posts resourceLogs JSON", async () => {
    const bodies: string[] = [];
    const sink = createOtlpHttpSessionTelemetrySink({
      endpoint: "http://collector.test/v1/logs",
      batchSize: 1,
      flushIntervalMs: 60_000,
      fetchImpl: async (_url, init) => {
        bodies.push(String(init?.body ?? ""));
        return new Response("", { status: 200 });
      },
    });
    sink.emit({
      channel: "ledger",
      time: 1_700_000_000_000,
      severity: "info",
      attributes: { "session.id": "s", "event.type": "turn/start", "event.seq": 1 },
      body: { turnId: "t" },
    });
    await sink.shutdown();
    expect(bodies).toHaveLength(1);
    const parsed = JSON.parse(bodies[0]!) as {
      resourceLogs: Array<{
        scopeLogs: Array<{ logRecords: unknown[] }>;
      }>;
    };
    expect(parsed.resourceLogs[0]!.scopeLogs[0]!.logRecords).toHaveLength(1);
  });

  it("resolve endpoint + default access", () => {
    expect(
      resolveOtlpLogsEndpoint({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      }),
    ).toBe("http://localhost:4318/v1/logs");
    expect(
      createDefaultSessionTelemetryAccess({ env: {} }).sink,
    ).toBeUndefined();
    expect(
      createDefaultSessionTelemetryAccess({
        env: { XRK_TELEMETRY: "memory" },
      }).sink,
    ).toBeTruthy();
    expect(
      createDefaultSessionTelemetryAccess({
        env: { XRK_TELEMETRY: "1" },
      }).sink,
    ).toBeUndefined();
    expect(
      createDefaultSessionTelemetryAccess({
        env: {
          XRK_TELEMETRY: "1",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
        },
      }).sink,
    ).toBeTruthy();
  });

  it("Face product config when XRK_TELEMETRY unset; env bypass wins", () => {
    expect(
      createDefaultSessionTelemetryAccess({
        env: {},
        product: { mode: "memory" },
      }).sink,
    ).toBeTruthy();
    expect(
      createDefaultSessionTelemetryAccess({
        env: {},
        product: { mode: "off" },
      }).sink,
    ).toBeUndefined();
    expect(
      createDefaultSessionTelemetryAccess({
        env: {},
        product: {
          mode: "otlp",
          endpoint: "http://collector.test/v1/logs",
        },
      }).sink,
    ).toBeTruthy();
    // CI bypass: XRK_TELEMETRY=0 wins over Face memory.
    expect(
      createDefaultSessionTelemetryAccess({
        env: { XRK_TELEMETRY: "0" },
        product: { mode: "memory" },
      }).sink,
    ).toBeUndefined();
  });
});
