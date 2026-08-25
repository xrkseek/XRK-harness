import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import {
  createFaceProjectionRegistry,
  createSessionListMetadataUnit,
  createTitleProjectionUnit,
  FaceTitleController,
  installDefaultFaceProjections,
} from "../src/projections/index.js";
import { createFaceRuntime } from "../src/runtime.js";

describe("FaceProjectionRegistry", () => {
  it("drives units and notifies onChanged with higher-seq values", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);

    const changes: { key: string; value: unknown; seq: number }[] = [];
    registry.onChanged((_id, key, value, seq) => {
      changes.push({ key, value, seq });
    });

    const e1 = store.append(session.id, {
      type: "user/message",
      ts: 10,
      turnId: "t1",
      content: "hello title world",
    });
    registry.drive(session.id, e1, 1);
    expect(
      changes.some((c) => c.key === "sessionListMetadata"),
    ).toBe(true);

    const e2 = store.append(session.id, {
      type: "session/title",
      ts: 11,
      title: "hello title",
      source: { kind: "fallback" },
      messageSeqs: [1],
    });
    registry.drive(session.id, e2, 2);
    expect(registry.snapshot(session.id).values.title).toBe("hello title");
    expect(registry.snapshot(session.id).asOfSeq).toBe(2);
  });

  it("title unit pins on user rename", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createTitleProjectionUnit());

    const user = store.append(session.id, {
      type: "session/title",
      ts: 1,
      title: "Pinned",
      source: { kind: "user" },
    });
    registry.drive(session.id, user, 1);

    const fallback = store.append(session.id, {
      type: "session/title",
      ts: 2,
      title: "Should not win",
      source: { kind: "fallback" },
    });
    registry.drive(session.id, fallback, 2);
    expect(registry.snapshot(session.id).values.title).toBe("Pinned");
    expect(registry.stateOf(session.id, "title")).toEqual({
      title: "Pinned",
      pinned: true,
    });
  });

  it("sessionListMetadata flips blank on turn/start", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionListMetadataUnit());

    const start = store.append(session.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    registry.drive(session.id, start, 1);
    expect(registry.snapshot(session.id).values.sessionListMetadata).toEqual({
      blank: false,
      lastPromptAt: null,
    });
  });
});

describe("FaceTitleController", () => {
  it("rename + fallback via append path", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);

    const titles = new FaceTitleController({
      append: (id, ev) => {
        const frozen = store.append(id, ev);
        const seq = store.get(id).events.length;
        registry.drive(id, frozen, seq);
        return frozen;
      },
      getEvents: (id) => store.get(id).events,
      projections: registry,
    });

    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "alpha beta gamma delta",
    });
    registry.drive(session.id, store.get(session.id).events[0]!, 1);
    titles.maybeFallbackFromUserMessage(
      session.id,
      1,
      "alpha beta gamma delta",
    );
    expect(registry.snapshot(session.id).values.title).toMatch(/alpha/);

    titles.rename(session.id, "  My Session  ");
    expect(registry.snapshot(session.id).values.title).toBe("My Session");
  });
});

describe("createFaceRuntime projection wire", () => {
  it("append user/message triggers fallback title + mux projection", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const mux: { type: string; key?: string; value?: unknown }[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    runtime.bus.subscribeMux((_id, f) => mux.push(f as typeof mux[number]));

    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "wire me a title please",
    });

    expect(runtime.projections.snapshot(session.id).values.title).toMatch(
      /wire me/,
    );
    expect(
      mux.some(
        (f) => f.type === "session/projection" && f.key === "title",
      ),
    ).toBe(true);
  });

  it("todos standing plan: todo/write then clear on turn/start", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);

    const changes: { key: string; value: unknown }[] = [];
    registry.onChanged((_id, key, value) => {
      changes.push({ key, value });
    });

    const w = store.append(session.id, {
      type: "todo/write",
      ts: 1,
      todos: [
        { content: "ship todos projection", status: "in_progress" },
        { content: "docs", status: "pending" },
      ],
    });
    registry.drive(session.id, w, 1);
    expect(registry.snapshot(session.id).values.todos).toEqual([
      { content: "ship todos projection", status: "in_progress" },
      { content: "docs", status: "pending" },
    ]);
    expect(changes.some((c) => c.key === "todos")).toBe(true);

    const start = store.append(session.id, {
      type: "turn/start",
      ts: 2,
      turnId: "t2",
    });
    registry.drive(session.id, start, 2);
    expect(registry.snapshot(session.id).values.todos).toBeNull();
  });

  it("Face patched append publishes session/projection todos then clears on turn/start", () => {
    const store = createMemorySessionStore();
    const mux: { type?: string; key?: string; value?: unknown }[] = [];
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    runtime.bus.subscribeMux((_id, f) => mux.push(f as (typeof mux)[number]));

    const created = store.create();
    expect(runtime.projections.snapshot(created.id).values.todos).toBeNull();

    store.append(created.id, {
      type: "todo/write",
      ts: 1,
      todos: [{ content: "dock", status: "pending" }],
    });
    expect(runtime.projections.snapshot(created.id).values.todos).toEqual([
      { content: "dock", status: "pending" },
    ]);
    expect(
      mux.some(
        (f) =>
          f.type === "session/projection" &&
          f.key === "todos" &&
          Array.isArray(f.value),
      ),
    ).toBe(true);

    store.append(created.id, {
      type: "turn/start",
      ts: 2,
      turnId: "t1",
    });
    expect(runtime.projections.snapshot(created.id).values.todos).toBeNull();
    expect(
      mux.some(
        (f) =>
          f.type === "session/projection" &&
          f.key === "todos" &&
          f.value === null,
      ),
    ).toBe(true);
  });

  it("todos standing plan survives context/compaction (DSH: plan ⊥ window)", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);

    const plan = [
      { content: "keep me", status: "in_progress" as const },
      { content: "also keep", status: "pending" as const },
    ];
    const w = store.append(session.id, {
      type: "todo/write",
      ts: 1,
      todos: plan,
    });
    registry.drive(session.id, w, 1);
    expect(registry.snapshot(session.id).values.todos).toEqual(plan);

    const compact = store.append(session.id, {
      type: "context/compaction",
      ts: 2,
      reason: "manual",
      summary: "## Objective\n- window swap",
      recent: "",
      shadowedTokenCount: 10,
    });
    registry.drive(session.id, compact, 2);
    expect(registry.snapshot(session.id).values.todos).toEqual(plan);
  });
});
