import { describe, expect, it } from "vitest";
import {
  createMemoryAttachmentStore,
  DEFAULT_IMAGE_LIMITS,
} from "@xrkseek/attachment";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createFaceProjectionRegistry,
  createImageLimitsProjectionUnit,
  installDefaultFaceProjections,
} from "../src/projections/index.js";
import { createFaceRuntime } from "../src/runtime.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

describe("Face imageLimits projection (DSH attachment intake)", () => {
  it("registers only when limits are supplied", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const without = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(without);
    expect("imageLimits" in without.snapshot(session.id).values).toBe(false);

    const withLimits = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(withLimits, {
      imageLimits: DEFAULT_IMAGE_LIMITS,
    });
    expect(withLimits.snapshot(session.id).values.imageLimits).toEqual(
      DEFAULT_IMAGE_LIMITS,
    );
  });

  it("is boot-constant: events never push imageLimits change frames", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createImageLimitsProjectionUnit(DEFAULT_IMAGE_LIMITS));

    const changes: string[] = [];
    registry.onChanged((_id, key) => {
      changes.push(key);
    });

    const e = store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    });
    registry.drive(session.id, e, 1);
    expect(changes.includes("imageLimits")).toBe(false);
    expect(registry.snapshot(session.id).values.imageLimits).toEqual(
      DEFAULT_IMAGE_LIMITS,
    );
  });

  it("session.history tail carries imageLimits when AttachmentStore is composed", async () => {
    const store = createMemorySessionStore();
    const attachments = createMemoryAttachmentStore();
    const runtime = createBareFaceRuntime({
      store,
      attachments,
      resolveAgent: unusedAgentResolve(),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const hist = await dispatchFaceMethod(runtime, "session.history", "h", {
      sessionId,
    });
    expect(hist.result.ok).toBe(true);
    if (!hist.result.ok) throw new Error("history");
    const projections = (
      hist.result.value as {
        projections?: { values: Record<string, unknown> };
      }
    ).projections;
    expect(projections?.values.imageLimits).toEqual(attachments.imageLimits);
  });

  it("leaves imageLimits absent when no AttachmentStore", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: unusedAgentResolve(),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const hist = await dispatchFaceMethod(runtime, "session.history", "h", {
      sessionId,
    });
    expect(hist.result.ok).toBe(true);
    if (!hist.result.ok) throw new Error("history");
    const projections = (
      hist.result.value as {
        projections?: { values: Record<string, unknown> };
      }
    ).projections;
    expect("imageLimits" in (projections?.values ?? {})).toBe(false);
  });

  it("patched append never mux-pushes imageLimits", () => {
    const store = createMemorySessionStore();
    const mux: { type?: string; key?: string }[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      attachments: createMemoryAttachmentStore(),
      resolveAgent: unusedAgentResolve(),
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
    });
    runtime.bus.subscribeMux((_id, f) =>
      mux.push(f as { type?: string; key?: string }),
    );
    const session = newSession(store);
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "ping",
    });
    expect(
      mux.some(
        (f) => f.type === "session/projection" && f.key === "imageLimits",
      ),
    ).toBe(false);
  });
});
