import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  rootUserAuthorizationBlock,
  roleDeniedTools,
} from "../src/agent-team-roles.js";

function user(text: string, source?: { kind: "user" | "inject" }): SessionEvent {
  return {
    type: "user/message",
    ts: 1,
    content: text,
    ...(source ? { source } : {}),
  } as SessionEvent;
}

describe("rootUserAuthorizationBlock", () => {
  it("returns the human's recent asks, oldest first, excluding injects", () => {
    const events = [
      user("injected skill catalog", { kind: "inject" }),
      user("first real ask"),
      user("second real ask"),
    ];
    const block = rootUserAuthorizationBlock({ parentEvents: events });
    expect(block).toBeTruthy();
    expect(block!).toContain("[what the user asked for]");
    expect(block!).toContain("first real ask");
    expect(block!).toContain("second real ask");
    // Oldest first.
    expect(block!.indexOf("first real ask")).toBeLessThan(
      block!.indexOf("second real ask"),
    );
    // The inject must not appear.
    expect(block!).not.toContain("injected skill catalog");
  });

  it("caps the number and length of retained messages", () => {
    const events = Array.from({ length: 10 }, (_, i) => user(`ask-${i}`));
    const block = rootUserAuthorizationBlock({ parentEvents: events });
    expect(block).toBeTruthy();
    // 4 messages max; newest four are ask-6..ask-9.
    for (let i = 0; i < 6; i += 1) {
      expect(block!).not.toContain(`ask-${i}`);
    }
    for (let i = 6; i < 10; i += 1) {
      expect(block!).toContain(`ask-${i}`);
    }
  });

  it("honors the fork seed cut so already-seeded asks are not duplicated", () => {
    const events = [
      user("before fork"),
      user("after fork"),
    ];
    const block = rootUserAuthorizationBlock({
      parentEvents: events,
      sinceEventCount: 1,
    });
    expect(block).toBeTruthy();
    expect(block!).not.toContain("before fork");
    expect(block!).toContain("after fork");
  });

  it("returns undefined when nothing human is recent", () => {
    expect(
      rootUserAuthorizationBlock({ parentEvents: [user("x", { kind: "inject" })] }),
    ).toBeUndefined();
    expect(rootUserAuthorizationBlock({ parentEvents: [] })).toBeUndefined();
  });

  it("denies write/shell/web/delegation tools for reviewer", () => {
    const denied = roleDeniedTools("reviewer");
    for (const name of [
      "apply_edit",
      "apply_patch",
      "write_file",
      "bash",
      "web_search",
      "web_fetch",
      "subagent",
      "send_message",
    ]) {
      expect(denied).toContain(name);
    }
    // A reviewer still reads.
    expect(denied).not.toContain("read_file");
    expect(denied).not.toContain("grep");
  });

  it("denies writes/shell but keeps web and browser for researcher", () => {
    const denied = roleDeniedTools("researcher");
    expect(denied).toContain("apply_patch");
    expect(denied).toContain("bash");
    // Browser/MCP follow the parent session; role floor does not hard-deny them.
    expect(denied).not.toContain("browser_open");
    expect(denied).not.toContain("mcp__playwright*");
    expect(denied).not.toContain("web_search");
    expect(denied).not.toContain("web_fetch");
  });

  it("denies delegation for worker but keeps write tools", () => {
    const denied = roleDeniedTools("worker");
    expect(denied).toContain("subagent");
    expect(denied).not.toContain("apply_patch");
    expect(denied).not.toContain("bash");
  });

  it("default and lead deny nothing", () => {
    expect(roleDeniedTools(undefined)).toEqual([]);
    expect(roleDeniedTools("default")).toEqual([]);
    expect(roleDeniedTools("lead")).toEqual([]);
  });
});
