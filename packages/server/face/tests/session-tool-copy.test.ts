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
    expect(parent).toContain("another parent session");
    expect(parent).not.toContain("Live siblings");

    const child = threadMessageDescription({
      kind: "delegated_child",
      siblingIds: ["sess_scout", "sess_other"],
    });
    expect(child).toContain("Live siblings: sess_scout, sess_other");
    expect(child).toContain("send_message");
  });

  it("workspace / subagent copy flips on IM vs coding", () => {
    expect(workspaceListDescription("qichuang")).toContain("No nested subagent");
    expect(workspaceListDescription("im")).toContain("subagent(workspace_id)");
    expect(workspaceSessionPromptDescription({ surface: "im" })).toContain(
      "not your child",
    );
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
    expect(teamGraphDescription()).toContain("auto peer-linked");
    expect(interruptAgentDescription()).toContain("close_agent");
    expect(closeAgentDescription()).toContain("snapshot");
    expect(waitAgentDescription()).toContain("idle");
  });
});
