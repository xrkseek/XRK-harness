import { describe, expect, it } from "vitest";
import {
  COLLAB_BOARD_THREAD_WINDOW_MS,
  formatCollabBoardText,
  formatTeamMateBoardText,
} from "../src/collab-board.js";

describe("formatCollabBoardText", () => {
  const now = 1_700_000_000_000;

  it("lists roster ids and last-day parent 主线 sessions without playbooks", () => {
    const text = formatCollabBoardText({
      now,
      membersCatalog:
        "- mem_68a69c0a9fdc4b53 [workspace] 发版员 · default · inject=minimal · 整理变更并发版",
      threads: [
        {
          id: "th_fresh",
          title: "0.5.12 发版",
          brief: "筹备发行说明",
          updatedAt: now - 60_000,
          sessions: [
            { sessionId: "sess_parent", self: true, sideline: "写 changelog" },
          ],
        },
        {
          id: "th_old",
          title: "上周调研",
          brief: "已结束",
          updatedAt: now - COLLAB_BOARD_THREAD_WINDOW_MS - 1,
          sessions: [{ sessionId: "sess_old" }],
        },
      ],
    });
    expect(text).toContain("mem_68a69c0a9fdc4b53");
    expect(text).toContain("Spawn: `subagent`");
    expect(text).toContain("thread_message");
    expect(text).toContain("pin optional");
    expect(text).toContain("th_fresh");
    expect(text).toContain("sess_parent*");
    expect(text).toContain("写 changelog");
    expect(text).not.toContain("th_old");
    expect(text).not.toContain("sess_old");
    expect(text).not.toContain("playbook:");
  });

  it("says none when no 主线 in the window", () => {
    const text = formatCollabBoardText({
      now,
      membersCatalog: "(no Agent Team members yet)",
      threads: [],
    });
    expect(text).toContain("(none)");
    expect(text).toContain("no Agent Team members yet");
  });

  it("lists unpinned parents when the 主线 window is empty", () => {
    const text = formatCollabBoardText({
      now,
      membersCatalog: "(no Agent Team members yet)",
      threads: [],
      unboundPeers: [
        {
          sessionId: "sess_peer",
          title: "写注入目录",
          sideline: "补 collab board",
          running: true,
        },
        { sessionId: "sess_self", title: "当前会话", self: true },
      ],
    });
    expect(text).toContain("(none)");
    expect(text).toContain("Unpinned parents");
    expect(text).toContain("sess_peer");
    expect(text).toContain("写注入目录");
    expect(text).toContain("补 collab board");
    expect(text).toContain("running");
    expect(text).toContain("sess_self*");
  });

  it("tells Frugal badges to Skill-load instead of spawn", () => {
    const text = formatCollabBoardText({
      now: 1_700_000_000_000,
      canSpawn: false,
      membersCatalog: "- mem_x 发版员",
      threads: [],
    });
    expect(text).toContain("no subagent tools");
    expect(text).toContain("Skill-load");
    expect(text).not.toContain("spawn `subagent`");
  });

  it("IM surface keeps thread_message and points subagent at coding workspaces", () => {
    const text = formatCollabBoardText({
      now,
      surface: "im",
      membersCatalog: "- mem_x coder",
      threads: [
        {
          id: "th_x",
          title: "visible pin",
          brief: "",
          updatedAt: now,
          sessions: [{ sessionId: "s1" }],
        },
      ],
    });
    expect(text).toContain("workspace_id");
    expect(text).toContain("thread_message");
    expect(text).toContain("th_x");
  });

  it("奇创 surface prefers workspace_session_prompt over nested subagents", () => {
    const text = formatCollabBoardText({
      now,
      surface: "qichuang",
      canSpawn: false,
      membersCatalog: "- mem_y",
      threads: [],
    });
    expect(text).toContain("workspace_session_prompt");
    expect(text).toContain("thread_message");
    expect(text).toContain("No nested subagent");
    expect(text).not.toContain("Spawn: `subagent`");
  });
});

describe("formatTeamMateBoardText", () => {
  it("lists siblings, marks self, and includes own task", () => {
    const text = formatTeamMateBoardText({
      parentSessionId: "sess_parent",
      mates: [
        {
          sessionId: "sess_a",
          label: "调研",
          memberId: "mem_scout",
          role: "researcher",
          self: true,
          running: true,
        },
        {
          sessionId: "sess_b",
          label: "施工",
          memberId: "mem_worker",
          role: "worker",
          sideline: "改 collab",
        },
      ],
      ownTask: {
        id: "task_1",
        title: "收集证据",
        status: "in_progress",
      },
    });
    expect(text).toContain("squad · parent=sess_parent");
    expect(text).toContain("sess_a*");
    expect(text).toContain("member=mem_scout");
    expect(text).toContain("sess_b");
    expect(text).toContain("改 collab");
    expect(text).toContain("thread_message");
    expect(text).toContain("your_task: task_1");
    expect(text).toContain("收集证据");
    expect(text).not.toContain("主线 (24h)");
  });
});
