import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FaceAgentRosterStore,
  GLOBAL_ROSTER_ID,
  applyRosterToolPolicy,
  memberIdProblem,
} from "../src/agent-roster-store.js";

describe("FaceAgentRosterStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-roster-"));
    dirs.push(dir);
    return dir;
  }

  it("accepts a natural id by adding the mem_ prefix, and says so when it cannot", () => {
    const store = new FaceAgentRosterStore(home());
    const member = store.upsert("ws", {
      id: "xrk-releaseer",
      name: "发版员",
      playbook: "Ship the release chain.",
      role: "worker",
    });
    expect(member?.id).toBe("mem_xrk-releaseer");
    expect(memberIdProblem("xrk-releaseer")).toBeUndefined();
    expect(memberIdProblem(undefined)).toBeUndefined();
    // Never silently mint a different id behind a caller-supplied one.
    expect(store.upsert("ws", { id: "../../etc", name: "坏 id", playbook: "x" })).toBeUndefined();
    expect(store.upsert("ws", { name: "坏 id", playbook: "x" })?.id.startsWith("mem_")).toBe(true);
    expect(memberIdProblem("../../etc")).toContain("invalid id");
  });

  it("seeds global base roles, workspace starts empty", () => {
    const store = new FaceAgentRosterStore(home());
    const names = store.list(GLOBAL_ROSTER_ID).map((row) => row.name);
    expect(names).toEqual([
      "调研员",
      "施工员",
      "审稿员",
      "调度员",
      "探网员",
      "文书员",
      "排障员",
      "测员",
    ]);
    expect(store.list("ws")).toEqual([]);
    expect(store.listVisible("ws").map((row) => row.scope)).toEqual([
      "global",
      "global",
      "global",
      "global",
      "global",
      "global",
      "global",
      "global",
    ]);
  });

  it("upserts a workspace member without dropping global seeds", () => {
    const store = new FaceAgentRosterStore(home());
    const member = store.upsert("ws", {
      name: "夜间发版",
      playbook: "Follow the existing release chain.",
      role: "worker",
    });
    expect(member?.id.startsWith("mem_")).toBe(true);
    expect(store.get("ws", "mem_seed_worker")?.scope).toBe("global");
    expect(store.get("ws", member!.id)?.playbook).toContain("release");
    expect(store.listVisible("ws").some((row) => row.name === "夜间发版")).toBe(true);
  });

  it("refuses writes to built-in catalog ids", () => {
    const store = new FaceAgentRosterStore(home());
    expect(
      store.upsert("ws", {
        id: "mem_seed_worker",
        name: "施工·本仓",
        playbook: "Workspace overlay playbook.",
        role: "worker",
      }),
    ).toBeUndefined();
    expect(store.get("ws", "mem_seed_worker")?.scope).toBe("global");
    expect(store.get("ws", "mem_seed_worker")?.seed).toBe(true);
    expect(store.list("ws")).toEqual([]);
    expect(
      store.upsertAtScope("ws", "global", {
        id: "mem_seed_worker",
        name: "施工员",
        playbook: "Promoted playbook.",
        role: "worker",
      }),
    ).toBeUndefined();
    expect(store.remove(GLOBAL_ROSTER_ID, "mem_seed_worker")).toBe(false);
  });

  it("keeps an allow-list weaker than the parent role, case-insensitive", () => {
    const names = ["Bash", "read", "grep", "glob", "Write_File", "web_search"];
    const tools = {
      list: () => names.map((name) => ({ name })),
      unregister: (name: string) => {
        const at = names.indexOf(name);
        if (at < 0) return false;
        names.splice(at, 1);
        return true;
      },
    };
    applyRosterToolPolicy(tools, "worker", {
      mode: "allow",
      names: ["BASH", "READ", "grep", "glob"],
    });
    expect(names).toEqual(["Bash", "read", "grep", "glob"]);
  });

  it("merges missing global seed ids and refreshes seed:true rows", () => {
    const dir = home();
    mkdirSync(path.join(dir, "agent-rosters"));
    writeFileSync(
      path.join(dir, "agent-rosters", "global.json"),
      JSON.stringify({
        version: 1,
        members: [
          {
            id: "mem_seed_researcher",
            name: "调研员",
            role: "researcher",
            playbook: "stale seed playbook",
            seed: true,
            updatedAt: 1,
            inject: "minimal",
            brief: "old",
            appearance: { shape: "blob", color: "mist" },
          },
        ],
      }),
    );
    const store = new FaceAgentRosterStore(dir);
    const ids = store.list(GLOBAL_ROSTER_ID).map((row) => row.id);
    expect(ids).toContain("mem_seed_researcher");
    expect(ids).toContain("mem_seed_worker");
    expect(ids).not.toContain("mem_seed_release");
    expect(store.get(GLOBAL_ROSTER_ID, "mem_seed_researcher")?.playbook).toContain(
      "workspace researcher",
    );
  });

  it("drops leftover seed rows no longer in the catalog", () => {
    const dir = home();
    mkdirSync(path.join(dir, "agent-rosters"));
    writeFileSync(
      path.join(dir, "agent-rosters", "global.json"),
      JSON.stringify({
        version: 1,
        members: [
          {
            id: "mem_seed_release",
            name: "发版干员",
            role: "worker",
            playbook: "Obsolete catalog seed.",
            seed: true,
            updatedAt: 1,
            inject: "minimal",
          },
          {
            id: "mem_custom",
            name: "夜班",
            role: "worker",
            playbook: "User-owned leftover.",
            updatedAt: 1,
            inject: "minimal",
          },
        ],
      }),
    );
    const store = new FaceAgentRosterStore(dir);
    const ids = store.list(GLOBAL_ROSTER_ID).map((row) => row.id);
    expect(ids).not.toContain("mem_seed_release");
    expect(ids).toContain("mem_custom");
    expect(ids).toContain("mem_seed_lead");
  });

  it("restores catalog body even if a leftover edit dropped seed", () => {
    const dir = home();
    const store = new FaceAgentRosterStore(dir);
    expect(
      store.upsert(GLOBAL_ROSTER_ID, {
        id: "mem_seed_researcher",
        name: "调研员",
        playbook: "Custom researcher playbook kept by the user.",
        role: "researcher",
      }),
    ).toBeUndefined();
    expect(store.get(GLOBAL_ROSTER_ID, "mem_seed_researcher")?.playbook).toContain(
      "workspace researcher",
    );
    mkdirSync(path.join(dir, "agent-rosters"), { recursive: true });
    writeFileSync(
      path.join(dir, "agent-rosters", "global.json"),
      JSON.stringify({
        version: 1,
        members: [
          {
            id: "mem_seed_researcher",
            name: "调研员",
            role: "researcher",
            playbook: "Custom researcher playbook kept by the user.",
            updatedAt: 1,
            inject: "minimal",
          },
        ],
      }),
    );
    const again = new FaceAgentRosterStore(dir);
    expect(again.get(GLOBAL_ROSTER_ID, "mem_seed_researcher")?.playbook).toContain(
      "workspace researcher",
    );
    expect(again.get(GLOBAL_ROSTER_ID, "mem_seed_researcher")?.seed).toBe(true);
    expect(
      again.listVisible("ws").find((row) => row.id === "mem_seed_researcher")?.catalog,
    ).toBe(true);
  });

  it("keeps extra body shapes and palettes on upsert", () => {
    const store = new FaceAgentRosterStore(home());
    const member = store.upsert(GLOBAL_ROSTER_ID, {
      name: "外形干员",
      playbook: "Uses a squircle loaf palette.",
      role: "worker",
      appearance: { shape: "squircle", color: "coral" },
    });
    expect(member?.appearance).toEqual({ shape: "squircle", color: "coral" });
    expect(store.get(GLOBAL_ROSTER_ID, member!.id)?.appearance).toEqual({
      shape: "squircle",
      color: "coral",
    });
    const kitted = store.upsert(GLOBAL_ROSTER_ID, {
      name: "装扮干员",
      playbook: "Wears a bow on a heart.",
      role: "worker",
      appearance: { shape: "heart", color: "honey", kit: "bow" },
    });
    expect(kitted?.appearance).toEqual({ shape: "heart", color: "honey", kit: "bow" });
  });
});
