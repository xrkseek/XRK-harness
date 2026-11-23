import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FaceWorkspaceRegistry } from "../src/workspace-registry.js";

describe("FaceWorkspaceRegistry forgetAbsent", () => {
  it("scrubs sessionOrder ghosts even when membership is already gone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ws-forget-"));
    const reg = new FaceWorkspaceRegistry(root);
    const { workspace } = reg.create(path.join(root, "proj"));
    const wsId = workspace.workspaceId;

    reg.attachSession("sess_live", wsId);
    reg.attachSession("sess_ghost", wsId);
    // Half-finished delete: membership cleared, order slot left behind.
    const doc = reg.exportState();
    const membership = { ...doc.membership };
    delete membership.sess_ghost;
    reg.importState(
      {
        ...doc,
        membership,
        sessionOrder: { ...doc.sessionOrder, [wsId]: ["sess_live", "sess_ghost"] },
      },
      root,
    );

    expect(reg.exportState().sessionOrder[wsId]).toContain("sess_ghost");

    const n = reg.forgetAbsent(new Set(["sess_live"]));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(reg.exportState().sessionOrder[wsId]).toEqual(["sess_live"]);
    expect(reg.isArchived("sess_ghost")).toBe(false);
  });
});
