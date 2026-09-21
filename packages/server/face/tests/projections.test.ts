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

  it("sessionListMetadata flips blank on command/run", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    registry.register(createSessionListMetadataUnit());

    const run = store.append(session.id, {
      type: "command/run",
      ts: 1,
      commandId: "c1",
      name: "mcp",
      source: { kind: "user" },
    });
    registry.drive(session.id, run, 1);
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

  it("workspaceChanges: workspace/changes upserts by turnId", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const registry = createFaceProjectionRegistry({
      getEvents: (id) => store.get(id).events,
    });
    installDefaultFaceProjections(registry);

    const summary1 = {
      turnId: "t1",
      cwd: "/w",
      files: [{ path: "a.ts", display: "a.ts", added: 1, deleted: 0 }],
      total: 1,
      added: 1,
      deleted: 0,
    };
    const first = store.append(session.id, {
      type: "workspace/changes",
      ts: 1,
      turnId: "t1",
      summary: summary1,
    });
    registry.drive(session.id, first, 1);
    expect(registry.snapshot(session.id).values.workspaceChanges).toEqual([
      { ...summary1, seq: 1 },
    ]);

    const summary1b = {
      ...summary1,
      files: [
        { path: "a.ts", display: "a.ts", added: 2, deleted: 1 },
        { path: "b.ts", display: "b.ts", added: 1, deleted: 0 },
      ],
      total: 2,
      added: 3,
      deleted: 1,
    };
    const replace = store.append(session.id, {
      type: "workspace/changes",
      ts: 2,
      turnId: "t1",
      summary: summary1b,
    });
    registry.drive(session.id, replace, 2);
    expect(registry.snapshot(session.id).values.workspaceChanges).toEqual([
      { ...summary1b, seq: 2 },
    ]);

    const summary2 = {
      turnId: "t2",
      cwd: "/w",
      files: [{ path: "c.ts", display: "c.ts", added: 0, deleted: 1 }],
      total: 1,
      added: 0,
      deleted: 1,
    };
    const second = store.append(session.id, {
      type: "workspace/changes",
      ts: 3,
      turnId: "t2",
      summary: summary2,
    });
    registry.drive(session.id, second, 3);
    expect(registry.snapshot(session.id).values.workspaceChanges).toEqual([
      { ...summary1b, seq: 2 },
      { ...summary2, seq: 3 },
    ]);
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

  it("Face patched append publishes session/projection turnOutline; draft stays quiet until turn/end", () => {
    const store = createMemorySessionStore();
    const mux: { type?: string; key?: string; value?: unknown; seq?: number }[] = [];
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
    expect(runtime.projections.snapshot(created.id).values.turnOutline).toEqual(
      [],
    );

    store.append(created.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    expect(runtime.projections.snapshot(created.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "", response: "" },
    ]);
    expect(
      mux.some(
        (f) =>
          f.type === "session/projection" &&
          f.key === "turnOutline" &&
          Array.isArray(f.value) &&
          (f.value as { turn: number }[])[0]?.turn === 1,
      ),
    ).toBe(true);

    const outlineBeforePrompt = mux.filter(
      (f) => f.type === "session/projection" && f.key === "turnOutline",
    ).length;
    store.append(created.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "ask rail",
    });
    expect(runtime.projections.snapshot(created.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "ask rail", response: "" },
    ]);
    expect(
      mux.filter(
        (f) => f.type === "session/projection" && f.key === "turnOutline",
      ).length,
    ).toBeGreaterThan(outlineBeforePrompt);

    const outlineBeforeDraft = mux.filter(
      (f) => f.type === "session/projection" && f.key === "turnOutline",
    ).length;
    store.append(created.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      content: "draft body",
    });
    expect(
      mux.filter(
        (f) => f.type === "session/projection" && f.key === "turnOutline",
      ).length,
    ).toBe(outlineBeforeDraft);
    expect(runtime.projections.snapshot(created.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "ask rail", response: "" },
    ]);

    store.append(created.id, {
      type: "turn/end",
      ts: 4,
      turnId: "t1",
      reason: { kind: "completed" },
    });
    expect(runtime.projections.snapshot(created.id).values.turnOutline).toEqual([
      { turn: 1, seq: 1, prompt: "ask rail", response: "draft body" },
    ]);
    expect(
      mux.some(
        (f) =>
          f.type === "session/projection" &&
          f.key === "turnOutline" &&
          Array.isArray(f.value) &&
          (f.value as { response: string }[])[0]?.response === "draft body",
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
