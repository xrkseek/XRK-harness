import { describe, expect, it } from "vitest";
import {
  closeAgentDescription,
  followupTaskDescription,
  interruptAgentDescription,
  listAgentsDescription,
  sessionInspectDescription,
  subagentDescription,
  teamGraphDescription,
  teamListDescription,
  threadMessageDescription,
  waitAgentDescription,
  workspaceListDescription,
  workspaceSessionPromptDescription,
} from "../src/session-tool-copy.js";

describe("session-tool-copy", () => {
  it("thread_message distinguishes parent vs sibling and lists live siblings", () => {
    const parent = threadMessageDescription({ kind: "coding_parent" });
    expect(parent).toContain("parent peer");
    expect(parent).toContain("same lane only");
    expect(parent).toContain("Never agent-home");
    expect(parent).not.toContain("向阳↔agent-home");
    expect(parent).not.toContain("Live siblings");

    const qichuang = threadMessageDescription({
      kind: "orchestrator",
      surface: "qichuang",
    });
    expect(qichuang).toContain("向阳↔agent-home");
    expect(qichuang).not.toContain("Never agent-home");

    const home = threadMessageDescription({
      kind: "coding_parent",
      fromAgentHome: true,
    });
    expect(home).toContain("agent-home↔向阳");
    expect(home).toContain("Never project coding");
    expect(home).not.toContain("Never agent-home");

    const child = threadMessageDescription({
      kind: "delegated_child",
      siblingIds: ["sess_scout", "sess_other"],
    });
    expect(child).toContain("Live siblings: sess_scout, sess_other");
    expect(child).toContain("send_message");
  });

  it("workspace / subagent copy flips on IM vs coding", () => {
    expect(workspaceListDescription("qichuang")).toContain("no nested subagent");
    expect(workspaceListDescription("im")).toContain("subagent(workspace_id)");
    expect(
      workspaceListDescription(undefined, { fromAgentHome: true }),
    ).toContain("向阳 or peer homes");
    expect(workspaceSessionPromptDescription({ surface: "im" })).toContain(
      "not your child",
    );
    expect(
      workspaceSessionPromptDescription({
        surface: undefined,
        fromAgentHome: true,
      }),
    ).toContain("never project coding");
    expect(
      subagentDescription({
        base: "BASE.",
        surface: "im",
        catalog: "- mem_x",
      }),
    ).toContain("Cross-workspace");
    expect(
      subagentDescription({
        base: "BASE.",
        surface: undefined,
        catalog: "- mem_x",
      }),
    ).toContain("IM-only");
  });

  it("team_list / inspect / list_agents respect listOnly and kind", () => {
    expect(
      teamListDescription({ listOnly: true, catalog: "- a" }),
    ).toContain("Read-only");
    expect(
      teamListDescription({ listOnly: false, catalog: "- a" }),
    ).toContain("team_save");
    expect(sessionInspectDescription("delegated_child")).toContain("squad board");
    expect(sessionInspectDescription("coding_parent")).toContain("collab board");
    expect(listAgentsDescription("delegated_child")).toContain(
      "teammates → squad board",
    );
  });

  it("followup / team_graph / interrupt / close / wait copy cover morph + auto-peer", () => {
    expect(followupTaskDescription()).toContain("child_gap");
    expect(teamGraphDescription()).toContain("auto peer-link");
    expect(interruptAgentDescription()).toContain("close_agent");
    expect(closeAgentDescription()).toContain("snapshot");
    expect(waitAgentDescription()).toContain("idle");
  });
});
