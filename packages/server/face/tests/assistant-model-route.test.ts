import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  FACE_ASSISTANT_SOURCE_PLACEHOLDER,
  assistantMessageSource,
  routeFromRequestHeader,
} from "../src/adapt/index.js";

describe("assistant message model route wiring", () => {
  it("mux assistant/message source follows request/header", () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    const session = store.create("sess-route");
    const frames: unknown[] = [];
    runtime.bus.subscribeMux((_id, frame) => {
      frames.push(frame);
    });

    store.append(session.id, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "minimax", model: "minimax-m2.5:free" },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 10, outputTokens: 4 },
    });

    const assistant = frames.find(
      (f) =>
        f &&
        typeof f === "object" &&
        (f as { type?: string }).type === "session/event" &&
        (f as { event?: { type?: string } }).event?.type === "assistant/message",
    ) as
      | {
          event: {
            data: {
              message: { source: { kind: string; provider: string; model: string } };
            };
          };
        }
      | undefined;
    expect(assistant?.event.data.message.source).toEqual({
      kind: "model",
      provider: "minimax",
      model: "minimax-m2.5:free",
    });
  });

  it("mux falls back to sessionModels when no header yet", () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    const session = store.create("sess-sel");
    runtime.sessionModels.set(session.id, {
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
    });
    const frames: unknown[] = [];
    runtime.bus.subscribeMux((_id, frame) => {
      frames.push(frame);
    });

    store.append(session.id, {
      type: "assistant/message",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
    });

    const assistant = frames.find(
      (f) =>
        f &&
        typeof f === "object" &&
        (f as { event?: { type?: string } }).event?.type === "assistant/message",
    ) as
      | {
          event: {
            data: { message: { source: { provider: string; model: string } } };
          };
        }
      | undefined;
    expect(assistant?.event.data.message.source).toMatchObject({
      provider: "openrouter",
      model: "minimax/minimax-m2.5:free",
    });
  });

  it("session.history stamps assistant source from prior request/header", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    const session = store.create("sess-hist");
    store.append(session.id, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "minimax", model: "minimax-m2.5:free" },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      content: "hi",
      usage: { inputTokens: 3, outputTokens: 1 },
    });

    const hist = await dispatchFaceMethod(runtime, "session.history", "h", {
      sessionId: session.id,
    });
    expect(hist.result.ok).toBe(true);
    if (!hist.result.ok) return;
    const events = (
      hist.result.value as {
        events: {
          event: {
            type: string;
            data: { message?: { source?: { provider: string; model: string } } };
          };
        }[];
      }
    ).events;
    const assistant = events.find((row) => row.event.type === "assistant/message");
    expect(assistant?.event.data.message?.source).toEqual({
      kind: "model",
      provider: "minimax",
      model: "minimax-m2.5:free",
    });
  });

  it("assistantMessageSource helpers normalize blanks to the placeholder", () => {
    expect(assistantMessageSource(undefined)).toEqual(
      FACE_ASSISTANT_SOURCE_PLACEHOLDER,
    );
    expect(assistantMessageSource({ provider: "  ", model: "x" })).toEqual(
      FACE_ASSISTANT_SOURCE_PLACEHOLDER,
    );
    expect(
      routeFromRequestHeader({
        type: "request/header",
        header: { config: { provider: "a", model: "b" } },
      }),
    ).toEqual({ provider: "a", model: "b" });
  });
});
