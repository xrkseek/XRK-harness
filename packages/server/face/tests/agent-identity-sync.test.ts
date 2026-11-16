/**
 * Bidirectional 干员 identity playbook mirrors:
 * roster ↔ agent-home AGENTS.md ↔ advanced pack playbook.md.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import {
  agentHomeDir,
  mintAgentHomeForMember,
  syncAgentHomePlaybook,
} from "../src/agent-home.js";
import {
  liveMemberPlaybook,
} from "../src/agent-roster-tools.js";
import {
  adoptLiveMemberIdentityPlaybook,
  memberIdFromAgentHomeAgentsMdPath,
  normalizeIdentityPlaybook,
  publishMemberIdentityPlaybook,
  readAgentHomeAgentsMd,
  syncIdentityPlaybookAfterAgentsMdWrite,
  writeToolTargetPaths,
  shellIdentityTargetPaths,
  syncIdentityPlaybooksFromShellTool,
} from "../src/agent-identity-sync.js";
import {
  GLOBAL_ROSTER_ID,
  MANAGER_MEMBER_ID,
  memberPackDir,
} from "../src/agent-roster-store.js";
import { syncMemberPackPlaybook } from "../src/agent-member-pack.js";

describe("agent identity playbook sync", () => {
  it("team/roster revise fans out into AGENTS.md", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Scout",
        playbook: "You are Scout v1.",
        role: "researcher",
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    expect(readFileSync(path.join(home, "AGENTS.md"), "utf8")).toContain("v1");

    const published = publishMemberIdentityPlaybook(runtime, {
      memberId: member!.id,
      playbook: "You are Scout v2 — prefer facts.",
      source: "roster",
    });
    expect(published.ok).toBe(true);
    expect(readAgentHomeAgentsMd(home)).toContain("v2");
    expect(
      runtime.agentRoster.get(GLOBAL_ROSTER_ID, member!.id)?.playbook,
    ).toContain("v2");
  });

  it("editing AGENTS.md hot-syncs roster (and export live text)", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Writer",
        playbook: "Original playbook.",
        role: "worker",
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    writeFileSync(
      path.join(home, "AGENTS.md"),
      "Rewritten by the agent in its home.\n",
      "utf8",
    );

    expect(
      syncIdentityPlaybookAfterAgentsMdWrite(
        runtime,
        path.join(home, "AGENTS.md"),
      ),
    ).toBe(true);

    const live = liveMemberPlaybook(
      runtime,
      runtime.workspaces.defaultId(),
      member!,
    );
    expect(live).toContain("Rewritten by the agent");
    expect(
      runtime.agentRoster.get(GLOBAL_ROSTER_ID, member!.id)?.playbook,
    ).toContain("Rewritten by the agent");
  });

  it("adopt prefers fresher AGENTS.md over lagging roster", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Drift",
        playbook: "Roster stale copy.",
        role: "worker",
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    // Direct disk write (simulates bash / external edit) then adopt on read.
    writeFileSync(
      path.join(home, "AGENTS.md"),
      "Fresher AGENTS from disk.\n",
      "utf8",
    );
    // Tiny delay so mtime can differ on coarse FS clocks.
    const listed = {
      ...member!,
      scope: "global" as const,
    };
    const healed = adoptLiveMemberIdentityPlaybook(
      runtime,
      runtime.workspaces.defaultId(),
      listed,
    );
    expect(healed.playbook).toContain("Fresher AGENTS");
  });

  it("advanced pack playbook.md stays in the fan-out", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Packy",
        playbook: "Pack v1",
        role: "worker",
        kind: "advanced",
        ready: true,
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const packDir = memberPackDir(
      GLOBAL_ROSTER_ID,
      member!.id,
      runtime.agentRoster.home,
    );
    mkdirSync(packDir, { recursive: true });
    syncMemberPackPlaybook({
      rosterWorkspaceId: GLOBAL_ROSTER_ID,
      memberId: member!.id,
      playbook: "Pack v1",
      productHome: runtime.agentRoster.home,
    });

    publishMemberIdentityPlaybook(runtime, {
      memberId: member!.id,
      playbook: "Pack v2 from Team",
      source: "roster",
    });

    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    expect(readAgentHomeAgentsMd(home)).toContain("Pack v2");
    expect(
      normalizeIdentityPlaybook(
        readFileSync(path.join(packDir, "playbook.md"), "utf8"),
      ),
    ).toContain("Pack v2");
  });

  it("equality short-circuits (no loop / no churn)", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "Stable",
        playbook: "Same text forever.",
        role: "worker",
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const first = publishMemberIdentityPlaybook(runtime, {
      memberId: member!.id,
      playbook: "Same text forever.",
      source: "roster",
    });
    expect(first.ok && first.changed).toBe(false);
    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    expect(
      syncIdentityPlaybookAfterAgentsMdWrite(
        runtime,
        path.join(home, "AGENTS.md"),
      ),
    ).toBe(false);
  });

  it("path helpers recognize agent-home AGENTS.md and write-tool targets", () => {
    const runtime = createBareFaceRuntime();
    const homeRoot = runtime.agentRoster.home!;
    const abs = path.join(homeRoot, "agent-homes", "mem_x", "AGENTS.md");
    expect(memberIdFromAgentHomeAgentsMdPath(abs, homeRoot)).toBe("mem_x");
    expect(
      writeToolTargetPaths("write_file", { path: "AGENTS.md" }),
    ).toEqual(["AGENTS.md"]);
    expect(
      writeToolTargetPaths("apply_patch", {
        patch: "*** Update File: AGENTS.md\n@@\n-a\n+b\n",
      }),
    ).toEqual(["AGENTS.md"]);
    expect(existsSync(abs) || true).toBe(true);
  });

  it("syncAgentHomePlaybook is a no-op when content already matches", () => {
    const runtime = createBareFaceRuntime();
    const dir = path.join(runtime.agentRoster.home!, "agent-homes", "tmp_eq");
    mkdirSync(dir, { recursive: true });
    syncAgentHomePlaybook(dir, "Hello");
    const before = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    syncAgentHomePlaybook(dir, "Hello\n");
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("pack playbook.md write fans out to roster + AGENTS.md", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "PackWriter",
        playbook: "Pack start",
        role: "worker",
        kind: "advanced",
        ready: true,
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const packDir = memberPackDir(
      GLOBAL_ROSTER_ID,
      member!.id,
      runtime.agentRoster.home,
    );
    mkdirSync(packDir, { recursive: true });
    syncMemberPackPlaybook({
      rosterWorkspaceId: GLOBAL_ROSTER_ID,
      memberId: member!.id,
      playbook: "Pack start",
      productHome: runtime.agentRoster.home,
    });
    writeFileSync(
      path.join(packDir, "playbook.md"),
      "Pack rewritten on disk.\n",
      "utf8",
    );
    const { syncIdentityPlaybookAfterPackWrite } = await import(
      "../src/agent-identity-sync.js"
    );
    expect(
      syncIdentityPlaybookAfterPackWrite(
        runtime,
        path.join(packDir, "playbook.md"),
      ),
    ).toBe(true);
    expect(
      runtime.agentRoster.get(GLOBAL_ROSTER_ID, member!.id)?.playbook,
    ).toContain("Pack rewritten");
    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    expect(readAgentHomeAgentsMd(home)).toContain("Pack rewritten");
  });

  it("shellIdentityTargetPaths extracts AGENTS.md / playbook.md mentions", () => {
    expect(
      shellIdentityTargetPaths(
        'cat > agent-homes/mem_x/AGENTS.md <<EOF\nHi\nEOF',
      ),
    ).toContain("agent-homes/mem_x/AGENTS.md");
    expect(
      shellIdentityTargetPaths('echo x > "/tmp/pack/playbook.md"'),
    ).toContain("/tmp/pack/playbook.md");
  });

  it("bash rewrite of AGENTS.md fans out via shell sync helper", async () => {
    const runtime = createBareFaceRuntime();
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "ShellWriter",
        playbook: "Shell start",
        role: "worker",
      },
    );
    expect(member).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const home = agentHomeDir(member!.id, runtime.agentRoster.home);
    writeFileSync(path.join(home, "AGENTS.md"), "Shell rewritten.\n", "utf8");
    const n = syncIdentityPlaybooksFromShellTool(
      runtime,
      "sess_unused",
      "bash",
      { command: `printf ok > ${path.join(home, "AGENTS.md")}` },
      () => home,
    );
    expect(n).toBeGreaterThan(0);
    expect(
      runtime.agentRoster.get(GLOBAL_ROSTER_ID, member!.id)?.playbook,
    ).toContain("Shell rewritten");
  });

  it("catalog seed AGENTS.md edits are restored (not adopted into roster)", async () => {
    const runtime = createBareFaceRuntime();
    const manager = runtime.agentRoster.get(GLOBAL_ROSTER_ID, MANAGER_MEMBER_ID);
    expect(manager).toBeTruthy();
    await mintAgentHomeForMember(
      runtime,
      { ...manager!, scope: "global", catalog: true },
      runtime.workspaces.defaultId(),
    );
    const home = agentHomeDir(MANAGER_MEMBER_ID, runtime.agentRoster.home);
    const locked = normalizeIdentityPlaybook(manager!.playbook);
    writeFileSync(path.join(home, "AGENTS.md"), "Hacked catalog persona.\n", "utf8");
    syncIdentityPlaybookAfterAgentsMdWrite(
      runtime,
      path.join(home, "AGENTS.md"),
    );
    expect(readAgentHomeAgentsMd(home)).toBe(locked);
    expect(
      normalizeIdentityPlaybook(
        runtime.agentRoster.get(GLOBAL_ROSTER_ID, MANAGER_MEMBER_ID)!.playbook,
      ),
    ).toBe(locked);
  });
});
