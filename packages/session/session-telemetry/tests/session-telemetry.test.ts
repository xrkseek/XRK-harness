import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  applyRedaction,
  basicRedactionRule,
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
      redactionRules: [],
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

  it("event.seq follows log length when wrapping an existing session", async () => {
    const sink = createMemorySessionTelemetrySink();
    const base = createMemorySessionStore();
    base.create("s1");
    base.append("s1", { type: "turn/start", ts: 1, turnId: "t0" });
    base.append("s1", {
      type: "turn/end",
      ts: 2,
      turnId: "t0",
      reason: { kind: "completed" },
    });
    base.append("s1", { type: "turn/start", ts: 3, turnId: "t1" });
    expect(base.readEvents("s1")).toHaveLength(3);

    const store = wrapStoreForSessionTelemetry({
      store: base,
      sink,
      sessionId: "s1",
      redactionRules: [],
    });
    store.append("s1", {
      type: "turn/end",
      ts: 4,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    const ledger = sink.records.filter((r) => r.channel === "ledger");
    expect(ledger).toHaveLength(1);
    // Face seq = 1-based length after append (not a fresh local counter at 1).
    expect(ledger[0]!.attributes["event.seq"]).toBe(4);
    await sink.shutdown();
  });

  it("basic redaction elides prompt/tool text; throwing rule drops emit", async () => {
    const sink = createMemorySessionTelemetrySink();
    const base = createMemorySessionStore();
    const store = wrapStoreForSessionTelemetry({
      store: base,
      sink,
      sessionId: "s1",
    });
    store.create("s1");
    store.append("s1", {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "SECRET_PROMPT_TEXT",
    });
    const ledger = sink.records.filter((r) => r.channel === "ledger");
    expect(ledger).toHaveLength(1);
    const body = JSON.stringify(ledger[0]!.body);
    expect(body).not.toContain("SECRET_PROMPT_TEXT");
    expect(body).toContain("elided");

    const dropped = applyRedaction(ledger[0]!, [
      () => {
        throw new Error("boom");
      },
    ]);
    expect(dropped).toBeUndefined();
    expect(basicRedactionRule(ledger[0]!).channel).toBe("ledger");
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

  // Face gates session.truncate on `typeof store.replacePrefix === 'function'`
  // and archived deletes on `store.delete`. A wrapper that drops them turns
  // every edit / delete / regenerate into `truncate-unsupported`, so the
  // optional verbs must survive wrapping exactly as the store declares them.
  describe("optional store verbs", () => {
    it("forwards replacePrefix / delete / archive / flush / releaseResident", () => {
      const sink = createMemorySessionTelemetrySink();
      const calls: string[] = [];
      const base = createMemorySessionStore();
      const extended = Object.assign(base, {
        replacePrefix(id: string) {
          calls.push(`replacePrefix:${id}`);
          return base.get(id);
        },
        delete(id: string) {
          calls.push(`delete:${id}`);
        },
        offloadToArchive(id: string) {
          calls.push(`offload:${id}`);
        },
        isOffloaded: () => true,
        flush(sessionId?: string) {
          calls.push(`flush:${sessionId ?? "*"}`);
        },
        releaseResident(sessionId: string) {
          calls.push(`release:${sessionId}`);
          return true;
        },
      });

      const store = wrapStoreForSessionTelemetry({ store: extended, sink });
      expect(typeof store.replacePrefix).toBe("function");
      expect(typeof store.delete).toBe("function");
      expect(typeof store.offloadToArchive).toBe("function");
      expect(typeof store.flush).toBe("function");
      expect(typeof store.releaseResident).toBe("function");

      store.create("s1");
      store.replacePrefix?.("s1", []);
      store.delete?.("s1");
      store.offloadToArchive?.("s1");
      store.flush?.("s1");
      expect(store.releaseResident?.("s1")).toBe(true);

      expect(calls).toEqual([
        "replacePrefix:s1",
        "delete:s1",
        "offload:s1",
        "flush:s1",
        "release:s1",
      ]);
      expect(store.isOffloaded?.()).toBe(true);
    });

    it("does not invent verbs the wrapped store lacks", () => {
      // Minimal double: only the four required verbs, like a lightweight test
      // fixture. The memory store does implement truncation, so it cannot
      // stand in for "absent".
      const minimal = {
        create: (id = "s") => ({ id, events: [] }),
        get: (id: string) => ({ id, events: [] }),
        has: () => true,
        list: () => [],
        readEvents: () => [],
        append: (_id: string, event: SessionEvent) => event,
      };
      const store = wrapStoreForSessionTelemetry({
        store: minimal,
        sink: createMemorySessionTelemetrySink(),
      });
      // "Absent" is the store's way of saying "unsupported" — a stub here would
      // make Face believe truncation works and then corrupt the log.
      expect(store.replacePrefix).toBeUndefined();
      expect(store.delete).toBeUndefined();
    });
  });
