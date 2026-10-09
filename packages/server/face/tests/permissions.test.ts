import { describe, expect, it, vi } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "@xrkseek/core-tools";
import { createReadOnlyToolPre, createSessionReadOnlyToolPre } from "@xrkseek/policy";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";
import {
  FACE_PERMISSION_TABLE,
  migrateAutoSessionsToFullAccess,
  pinInheritedPermission,
  pinInitialPermission,
} from "../src/permissions.js";
import { createFacePermissionAutoGate } from "../src/permission-auto.js";
import {
  foldPermissionKnobs,
  pathAccessModeFromSandbox,
} from "@xrkseek/protocol";

function bareRuntime(store = createMemorySessionStore()) {
  return createBareFaceRuntime({
    store,
    resolveAgent: admittingAgentResolve(store),
  });
}

describe("Face permission presets", () => {
  it("maps danger-full-access to open pathAccessMode", () => {
    expect(pathAccessModeFromSandbox("danger-full-access")).toBe("open");
    expect(pathAccessModeFromSandbox("workspace-write")).toBe("allowlisted");
    expect(pathAccessModeFromSandbox("read-only")).toBe("allowlisted");
    expect(FACE_PERMISSION_TABLE["danger-full-access"].description).toMatch(
      /open path gate/i,
    );
  });

  it("pinInheritedPermission copies parent knobs onto a child", () => {
    const store = createMemorySessionStore();
    const parent = store.create().id;
    const child = store.create().id;
    pinInitialPermission(store, parent, "danger-full-access");
    pinInheritedPermission(store, parent, child);
    const knobs = foldPermissionKnobs(store.get(child).events);
    expect(knobs.preset).toBe("danger-full-access");
    expect(knobs.sandbox).toBe("danger-full-access");
    expect(pathAccessModeFromSandbox(knobs.sandbox)).toBe("open");
  });

  it("pins workspace-write on session.create and projects permissions", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    expect(runtime.store.get(sessionId).events.map((e) => e.type)).toEqual([
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
    ]);

    const snap = runtime.projections.snapshot(sessionId).values.permissions as {
      currentValue: string;
      options: { value: string }[];
    };
    expect(snap.currentValue).toBe("workspace-write");
    expect(snap.options.map((o) => o.value)).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
  });

  it("registerAuto publishes auto in catalog; unload withdraws it", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    expect(
      (
        runtime.projections.snapshot(sessionId).values.permissions as {
          options: { value: string }[];
        }
      ).options.map((o) => o.value),
    ).not.toContain("auto");

    const without = await dispatchFaceMethod(runtime, "commands/execute", "x0", {
      args: { agentId: sessionId, line: "/permission auto" },
    });
    expect(without.result.ok).toBe(true);
    if (without.result.ok) {
      expect(without.result.value).toMatchObject({
        result: {
          kind: "error",
          text: expect.stringMatching(/unknown preset "auto"/),
        },
      });
    }

    let admissions = 0;
    const stop = runtime.permissionAuto.registerAuto(
      () => {
        admissions += 1;
      },
      {
        migrateAway: () => {
          migrateAutoSessionsToFullAccess(runtime.store, runtime.permissionAuto);
        },
      },
    );
    expect(runtime.permissionAuto.catalogNames()).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
      "auto",
    ]);
    expect(
      (
        runtime.projections.snapshot(sessionId).values.permissions as {
          options: { value: string }[];
        }
      ).options.map((o) => o.value),
    ).toContain("auto");

    expect(() => runtime.permissionAuto.registerAuto(() => {})).toThrow(
      /already registered/,
    );

    const switched = await dispatchFaceMethod(runtime, "commands/execute", "ea", {
      args: { agentId: sessionId, line: "/permission auto" },
    });
    expect(switched.result.ok).toBe(true);
    if (switched.result.ok) {
      expect(switched.result.value).toMatchObject({
        result: { kind: "success", text: "permission mode auto" },
      });
    }
    expect(admissions).toBe(1);

    const events = runtime.store.get(sessionId).events;
    const lastPreset = [...events].reverse().find((e) => e.type === "permission/preset");
    const lastSandbox = [...events].reverse().find((e) => e.type === "sandbox/mode");
    const lastApproval = [...events].reverse().find((e) => e.type === "approval/policy");
    expect(lastPreset).toMatchObject({ type: "permission/preset", preset: "auto" });
    expect(lastSandbox).toMatchObject({
      type: "sandbox/mode",
      mode: "danger-full-access",
    });
    expect(lastApproval).toMatchObject({
      type: "approval/policy",
      policy: "ask",
    });
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "auto" });

    // Auto↔Full share danger-full-access sandbox: write identity + only the
    // approval policy that changes (DSH shared-bundle switch).
    const beforeFull = runtime.store.get(sessionId).events.length;
    await dispatchFaceMethod(runtime, "commands/execute", "ef", {
      args: { agentId: sessionId, line: "/permission danger-full-access" },
    });
    const autoToFull = runtime.store
      .get(sessionId)
      .events.slice(beforeFull)
      .filter(
        (e) =>
          e.type === "permission/preset" ||
          e.type === "sandbox/mode" ||
          e.type === "approval/policy",
      )
      .map((e) =>
        e.type === "permission/preset"
          ? [e.type, (e as { preset: string }).preset]
          : e.type === "sandbox/mode"
            ? [e.type, (e as { mode: string }).mode]
            : [e.type, (e as { policy: string }).policy],
      );
    expect(autoToFull).toEqual([
      ["permission/preset", "danger-full-access"],
      ["approval/policy", "never"],
    ]);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });

    const beforeAuto = runtime.store.get(sessionId).events.length;
    await dispatchFaceMethod(runtime, "commands/execute", "ea2", {
      args: { agentId: sessionId, line: "/permission auto" },
    });
    expect(admissions).toBe(2);
    const fullToAuto = runtime.store
      .get(sessionId)
      .events.slice(beforeAuto)
      .filter(
        (e) =>
          e.type === "permission/preset" ||
          e.type === "sandbox/mode" ||
          e.type === "approval/policy",
      )
      .map((e) =>
        e.type === "permission/preset"
          ? [e.type, (e as { preset: string }).preset]
          : e.type === "sandbox/mode"
            ? [e.type, (e as { mode: string }).mode]
            : [e.type, (e as { policy: string }).policy],
      );
    expect(fullToAuto).toEqual([
      ["permission/preset", "auto"],
      ["approval/policy", "ask"],
    ]);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "auto" });

    // Auto identity survives an approval=never pin (delegated child); current
    // stays auto until Full is selected.
    runtime.store.append(sessionId, {
      type: "approval/policy",
      ts: Date.now(),
      policy: "never",
    });
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "auto" });

    // Dispose: migrate Auto → Full, abort lifecycle, then withdraw catalog.
    const life = runtime.permissionAuto.lifecycle()!;
    expect(life.signal.aborted).toBe(false);
    stop();
    expect(life.signal.aborted).toBe(true);
    expect(runtime.permissionAuto.isLive()).toBe(false);
    expect(runtime.permissionAuto.isAccepting()).toBe(false);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });
    expect(
      (
        runtime.projections.snapshot(sessionId).values.permissions as {
          options: { value: string }[];
        }
      ).options.map((o) => o.value),
    ).not.toContain("auto");

    const afterUnload = await dispatchFaceMethod(
      runtime,
      "commands/execute",
      "x1",
      { args: { agentId: sessionId, line: "/permission auto" } },
    );
    expect(afterUnload.result.ok).toBe(true);
    if (afterUnload.result.ok) {
      expect(afterUnload.result.value).toMatchObject({
        result: {
          kind: "error",
          text: expect.stringMatching(/unknown preset "auto"/),
        },
      });
    }
  });

  it("rejects restoring a seeded Auto session without live integration", () => {
    const store = createMemorySessionStore();
    const session = store.create("seed-auto");
    store.append(session.id, {
      type: "permission/preset",
      ts: 1,
      preset: "auto",
    });
    store.append(session.id, {
      type: "sandbox/mode",
      ts: 2,
      mode: "danger-full-access",
    });
    store.append(session.id, {
      type: "approval/policy",
      ts: 3,
      policy: "ask",
    });
    expect(() =>
      pinInitialPermission(store, session.id, "workspace-write"),
    ).toThrow(/cannot restore preset "auto"/);

    const gate = createFacePermissionAutoGate();
    let admissions = 0;
    gate.registerAuto(() => {
      admissions += 1;
    });
    pinInitialPermission(store, session.id, "workspace-write", {
      autoGate: gate,
    });
    expect(admissions).toBe(1);
  });

  it("closes admission before migrateAway observers can re-select Auto", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    let sawClosedAdmit = false;
    const stop = runtime.permissionAuto.registerAuto(
      () => {
        /* admit */
      },
      {
        migrateAway: () => {
          migrateAutoSessionsToFullAccess(runtime.store, runtime.permissionAuto);
          try {
            runtime.permissionAuto.admit();
          } catch {
            sawClosedAdmit = true;
          }
        },
      },
    );

    await dispatchFaceMethod(runtime, "commands/execute", "ea", {
      args: { agentId: sessionId, line: "/permission auto" },
    });
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "auto" });

    stop();
    expect(sawClosedAdmit).toBe(true);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });
  });

  it("/permission switches preset; empty reports current; unknown errors", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const empty = await dispatchFaceMethod(runtime, "commands/execute", "e0", {
      args: { agentId: sessionId, line: "/permission" },
    });
    expect(empty.result.ok).toBe(true);
    if (empty.result.ok) {
      expect(empty.result.value).toMatchObject({
        result: {
          kind: "success",
          text: expect.stringContaining("workspace-write"),
        },
      });
    }

    const ro = await dispatchFaceMethod(runtime, "commands/execute", "e1", {
      args: { agentId: sessionId, line: "/permission read-only" },
    });
    expect(ro.result.ok).toBe(true);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "read-only" });

    const again = await dispatchFaceMethod(runtime, "commands/execute", "e2", {
      args: { agentId: sessionId, line: "/permission read-only" },
    });
    expect(again.result.ok).toBe(true);
    const presets = runtime.store
      .get(sessionId)
      .events.filter((e) => e.type === "permission/preset");
    expect(presets).toHaveLength(2);

    const bad = await dispatchFaceMethod(runtime, "commands/execute", "e3", {
      args: { agentId: sessionId, line: "/permission not-a-preset" },
    });
    expect(bad.result.ok).toBe(true);
    if (bad.result.ok) {
      expect(bad.result.value).toMatchObject({
        result: { kind: "error", text: expect.stringContaining("unknown preset") },
      });
    }

    const danger = await dispatchFaceMethod(runtime, "commands/execute", "e4", {
      args: { agentId: sessionId, line: "/permission danger-full-access" },
    });
    expect(danger.result.ok).toBe(true);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });
  });

  it("refuses sandbox mode change while hasPtyActivity is true", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      hasPtyActivity: () => true,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const blocked = await dispatchFaceMethod(runtime, "commands/execute", "b", {
      args: { agentId: sessionId, line: "/permission read-only" },
    });
    expect(blocked.result.ok).toBe(true);
    if (blocked.result.ok) {
      expect(blocked.result.value).toMatchObject({
        result: {
          kind: "error",
          text: expect.stringContaining("cannot change sandbox mode"),
        },
      });
    }
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "workspace-write" });
  });

  it("approval never auto-allows without approval/requested", async () => {
    const store = createMemorySessionStore();
    const mux: unknown[] = [];
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    runtime.bus.subscribeMux((_id, frame) => mux.push(frame));

    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    await dispatchFaceMethod(runtime, "commands/execute", "sw", {
      args: { agentId: sessionId, line: "/permission danger-full-access" },
    });

    const pipeline = createToolPipeline();
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "ran" }));
    reg.register({
      name: "danger",
      description: "d",
      parameters: {},
      execute: body,
    });
    pipeline.onPre(async () => ({ action: "ask", reason: "need human" }));

    const out = await runToolDetailed({
      registry: reg,
      call: { id: "call_1", name: "danger", arguments: {} },
      pipeline,
    });
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("ran");
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);
    expect(
      mux.some(
        (f) =>
          typeof f === "object" &&
          f !== null &&
          (f as { type?: string }).type === "approval/requested",
      ),
    ).toBe(false);
  });

  it("read-only pre denies apply_edit", async () => {
    const pipeline = createToolPipeline();
    pipeline.onPre(createReadOnlyToolPre());
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "wrote" }));
    reg.register({
      name: "apply_edit",
      description: "w",
      parameters: {},
      execute: body,
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "c", name: "apply_edit", arguments: {} },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.result.isError).toBe(true);
  });

  it("session read-only pre tracks live sandbox knob (no stale ask path)", async () => {
    const store = createMemorySessionStore();
    const runtime = bareRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    let readOnly = false;
    const pipeline = createToolPipeline();
    pipeline.onPre(
      createSessionReadOnlyToolPre(() => readOnly),
    );
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "wrote" }));
    reg.register({
      name: "apply_edit",
      description: "w",
      parameters: {},
      execute: body,
    });
    pipeline.onPre(async () => ({ action: "ask", reason: "need?" }));

    // Not read-only yet: ask path → approval never after danger preset.
    await dispatchFaceMethod(runtime, "commands/execute", "sw", {
      args: { agentId: sessionId, line: "/permission danger-full-access" },
    });
    const allowed = await runToolDetailed({
      registry: reg,
      call: { id: "c1", name: "apply_edit", arguments: {} },
      pipeline,
    });
    expect(body).toHaveBeenCalled();
    expect(allowed.result.content).toBe("wrote");
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);

    body.mockClear();
    readOnly = true;
    const denied = await runToolDetailed({
      registry: reg,
      call: { id: "c2", name: "apply_edit", arguments: {} },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(denied.result.isError).toBe(true);
  });

  it("settings permission.defaultPreset live-applies to sessions still on prior default", async () => {
    const store = createMemorySessionStore();
    const invalidated: string[] = [];
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      invalidateAgent: async (id) => {
        invalidated.push(id);
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "workspace-write" });

    const mutated = await dispatchFaceMethod(runtime, "settings.mutate", "m", {
      ns: "permission",
      ops: [{ op: "set", path: ["defaultPreset"], value: "danger-full-access" }],
    });
    expect(mutated.result.ok).toBe(true);
    expect(
      runtime.projections.snapshot(sessionId).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });
    expect(invalidated).toContain(sessionId);

    const pipeline = createToolPipeline();
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    pipeline.onPre(async () => ({ action: "ask", reason: "need human" }));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "ran" }));
    reg.register({
      name: "danger",
      description: "d",
      parameters: {},
      execute: body,
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "call_live", name: "danger", arguments: {} },
      pipeline,
    });
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("ran");
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);
  });
});

/**
 * Loop checklist: Auto is session-catalog-only while registerAuto is live;
 * Settings defaultPreset never offers auto; dispose migrates to Full access.
 */
describe("Auto catalog / Settings defaultPreset / dispose migrate", () => {
  it("omits auto from catalogNames until registerAuto; withdraws on dispose", () => {
    const gate = createFacePermissionAutoGate();
    expect(gate.isLive()).toBe(false);
    expect(gate.catalogNames()).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
    expect(gate.catalogNames()).not.toContain("auto");

    const stop = gate.registerAuto(() => {});
    expect(gate.isLive()).toBe(true);
    expect(gate.catalogNames()).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
      "auto",
    ]);

    stop();
    expect(gate.isLive()).toBe(false);
    expect(gate.catalogNames()).not.toContain("auto");
  });

  it("Settings defaultPreset rejects auto (schema has no auto)", async () => {
    const runtime = bareRuntime();
    const rejected = await dispatchFaceMethod(runtime, "settings.mutate", "pa", {
      ns: "permission",
      ops: [{ op: "set", path: ["defaultPreset"], value: "auto" }],
    });
    expect(rejected.result.ok).toBe(false);
    if (!rejected.result.ok) {
      expect(rejected.result.error.code).toBe("settings-rejected");
    }

    // Even with session-catalog Auto live, Settings still list configured presets only.
    runtime.permissionAuto.registerAuto(() => {});
    const ok = await dispatchFaceMethod(runtime, "settings.mutate", "pw", {
      ns: "permission",
      ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
    });
    expect(ok.result.ok).toBe(true);

    const stillRejected = await dispatchFaceMethod(
      runtime,
      "settings.mutate",
      "pa2",
      {
        ns: "permission",
        ops: [{ op: "set", path: ["defaultPreset"], value: "auto" }],
      },
    );
    expect(stillRejected.result.ok).toBe(false);
  });

  it("dispose migrateAway moves Auto sessions to danger-full-access", async () => {
    const runtime = bareRuntime();
    const a = await dispatchFaceMethod(runtime, "session.create", "a", {});
    const b = await dispatchFaceMethod(runtime, "session.create", "b", {});
    if (!a.result.ok || !b.result.ok) throw new Error("create");
    const sessionA = (a.result.value as { sessionId: string }).sessionId;
    const sessionB = (b.result.value as { sessionId: string }).sessionId;

    const stop = runtime.permissionAuto.registerAuto(
      () => {
        /* admit */
      },
      {
        migrateAway: () => {
          migrateAutoSessionsToFullAccess(runtime.store, runtime.permissionAuto);
        },
      },
    );

    await dispatchFaceMethod(runtime, "commands/execute", "ea", {
      args: { agentId: sessionA, line: "/permission auto" },
    });
    // sessionB stays on the default (workspace-write) — must not be rewritten.
    expect(
      runtime.projections.snapshot(sessionA).values.permissions,
    ).toMatchObject({ currentValue: "auto" });
    expect(
      runtime.projections.snapshot(sessionB).values.permissions,
    ).toMatchObject({ currentValue: "workspace-write" });

    stop();

    expect(runtime.permissionAuto.isLive()).toBe(false);
    expect(runtime.permissionAuto.catalogNames()).not.toContain("auto");
    expect(
      runtime.projections.snapshot(sessionA).values.permissions,
    ).toMatchObject({ currentValue: "danger-full-access" });
    expect(
      runtime.projections.snapshot(sessionB).values.permissions,
    ).toMatchObject({ currentValue: "workspace-write" });
    expect(
      (
        runtime.projections.snapshot(sessionA).values.permissions as {
          options: { value: string }[];
        }
      ).options.map((o) => o.value),
    ).not.toContain("auto");
  });
});
