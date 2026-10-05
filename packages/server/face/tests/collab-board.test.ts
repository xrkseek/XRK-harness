import { describe, expect, it } from "vitest";
import {
  COLLAB_BOARD_THREAD_WINDOW_MS,
  formatCollabBoardText,
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
    expect(text).toContain("standing inject");
    expect(text).toContain("thread_message");
    expect(text).toContain("Do not thread_switch to send mail");
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
});
