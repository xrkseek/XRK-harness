import { describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { mintAgentHomeForMember } from "../src/agent-home.js";
import { sessionCreate } from "../src/handlers/session.js";
import { listWorkspacesForDiscovery } from "../src/workspace-discovery.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";

describe("workspace_list discovery filter", () => {
  it("defaults to active-only and surfaces dormant via query / includeInactive", async () => {
    const runtime = createBareFaceRuntime();
    const xyId = runtime.workspaces.defaultId();
    expect(xyId).toBe(XIANGYANG_WORKSPACE_ID);

    const xySession = await sessionCreate(runtime, "wd-xy", { workspaceId: xyId });
    expect(xySession.ok).toBe(true);
    if (!xySession.ok) return;
    const xySess = String(
      (xySession.value as { sessionId?: string }).sessionId ?? "",
    );

    const staleDir = path.join(runtime.productDir!, "stale-coding");
    mkdirSync(staleDir, { recursive: true });
    const stale = runtime.workspaces.create(staleDir);
    // Force last activity far in the past so the default 7d window drops it.
    const row = runtime.workspaces.get(stale.workspace.workspaceId);
    if (row) {
      row.title = "Stale Lab";
      row.updatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const member = runtime.agentRoster.upsertAtScope(xyId, "global", {
      name: "Finder",
      playbook: "Find workspaces.",
      role: "worker",
    });
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(runtime, member!, xyId);

    const activeOnly = listWorkspacesForDiscovery(runtime, xySess, {});
    expect(
      activeOnly.items.some((r) => r.workspaceId === stale.workspace.workspaceId),
    ).toBe(false);
    expect(activeOnly.omittedInactive).toBeGreaterThanOrEqual(1);
    expect(
      activeOnly.items.some((r) => r.workspaceId === XIANGYANG_WORKSPACE_ID),
    ).toBe(true);
    // Lean wire: active rows omit `active`; no lastActiveAt echo.
    const xyRow = activeOnly.items.find(
      (r) => r.workspaceId === XIANGYANG_WORKSPACE_ID,
    );
    expect(xyRow?.active).toBeUndefined();
    expect(
      activeOnly.items.every((r) => !("lastActiveAt" in r)),
    ).toBe(true);

    const byQuery = listWorkspacesForDiscovery(runtime, xySess, {
      query: "Stale Lab",
    });
    expect(
      byQuery.items.some((r) => r.workspaceId === stale.workspace.workspaceId),
    ).toBe(true);

    const withInactive = listWorkspacesForDiscovery(runtime, xySess, {
      includeInactive: true,
    });
    expect(
      withInactive.items.some(
        (r) => r.workspaceId === stale.workspace.workspaceId,
      ),
    ).toBe(true);
  });
});
