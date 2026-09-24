/** Shell hooks: Pre/PostToolUse + multi-event hooks.json parse; matcher + fail-open. */
import { describe, expect, it, vi } from "vitest";
import {
  createShellHookPost,
  createShellHookPre,
  createShellLifecycleHooks,
  loadShellHooksConfig,
  parsePreToolUseHooks,
  parseShellHooksConfig,
  toolNameMatches,
} from "../src/shell-hooks.js";
import { createToolPipeline, createToolRegistry } from "@xrkseek/core-tools";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parseShellHooksConfig", () => {
  it("reads Claude Pre/Post + turn/compact/subagent; ignores prompt-type hooks", () => {
    const config = parseShellHooksConfig({
      hooks: {
        PreToolUse: [
          {
            matcher: "bash|write_file",
            hooks: [
              { type: "command", command: "node gate.js", timeout: 5 },
              { type: "prompt", command: "ignored" },
            ],
          },
        ],
        PostToolUse: [
          { matcher: "*", hooks: [{ type: "command", command: "echo post" }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "echo prompt" }] },
        ],
        Stop: [{ hooks: [{ command: "echo stop" }] }],
        PreCompact: [{ hooks: [{ command: "echo pre-c" }] }],
        PostCompact: [{ hooks: [{ command: "echo post-c" }] }],
        SubagentStart: [
          {
            matcher: "general-purpose",
            hooks: [{ command: "echo sa-start" }],
          },
        ],
        SubagentStop: [{ hooks: [{ command: "echo sa-stop" }] }],
      },
    });
    expect(config.PreToolUse).toEqual([
      { command: "node gate.js", matcher: "bash|write_file", timeoutMs: 5000 },
    ]);
    expect(config.PostToolUse).toEqual([{ command: "echo post", matcher: "*" }]);
    expect(config.UserPromptSubmit).toEqual([{ command: "echo prompt" }]);
    expect(config.Stop).toEqual([{ command: "echo stop" }]);
    expect(config.PreCompact?.[0]?.command).toBe("echo pre-c");
    expect(config.SubagentStart?.[0]?.matcher).toBe("general-purpose");
  });

  it("normalizes Codex camelCase event names", () => {
    const config = parseShellHooksConfig({
      hooks: {
        preToolUse: [{ hooks: [{ command: "pre.sh" }] }],
        postToolUse: [{ hooks: [{ command: "post.sh" }] }],
        preCompact: [{ hooks: [{ command: "pc.sh" }] }],
      },
    });
    expect(config.PreToolUse).toEqual([{ command: "pre.sh" }]);
    expect(config.PostToolUse).toEqual([{ command: "post.sh" }]);
    expect(config.PreCompact).toEqual([{ command: "pc.sh" }]);
  });

  it("parsePreToolUseHooks stays PreToolUse-only (back-compat)", () => {
    const commands = parsePreToolUseHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: "bash|write_file",
            hooks: [
              { type: "command", command: "node gate.js", timeout: 5 },
              { type: "prompt", command: "ignored" },
            ],
          },
        ],
        PostToolUse: [
          { matcher: "*", hooks: [{ type: "command", command: "echo post" }] },
        ],
      },
    });
    expect(commands).toEqual([
      { command: "node gate.js", matcher: "bash|write_file", timeoutMs: 5000 },
    ]);
  });

  it("accepts a bare event map", () => {
    expect(
      parsePreToolUseHooks({
        PreToolUse: [{ hooks: [{ command: "deny.sh" }] }],
      }),
    ).toEqual([{ command: "deny.sh" }]);
  });
});

describe("toolNameMatches", () => {
  it("matches all / Claude literals / regex", () => {
    expect(toolNameMatches(undefined, "bash")).toBe(true);
    expect(toolNameMatches("*", "bash")).toBe(true);
    expect(toolNameMatches("bash|write_file", "bash")).toBe(true);
    expect(toolNameMatches("bash|write_file", "read_file")).toBe(false);
    expect(toolNameMatches("^write_", "write_file")).toBe(true);
    expect(toolNameMatches("[", "bash")).toBe(false);
  });
});

describe("loadShellHooksConfig", () => {
  it("skips missing files and loads a valid hooks.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-hooks-"));
    const file = path.join(dir, "hooks.json");
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ command: "echo ok" }] }],
          PostToolUse: [{ hooks: [{ command: "echo post" }] }],
        },
      }),
    );
    const config = loadShellHooksConfig([path.join(dir, "missing.json"), file]);
    expect(config.PreToolUse).toEqual([{ command: "echo ok" }]);
    expect(config.PostToolUse).toEqual([{ command: "echo post" }]);
  });
});

describe("createShellHookPre", () => {
  async function runWithHook(
    runner: Parameters<typeof createShellHookPre>[0]["runner"],
    commands: Parameters<typeof createShellHookPre>[0]["commands"],
  ) {
    const pipeline = createToolPipeline();
    pipeline.onPre(createShellHookPre({ commands, cwd: "/ws", runner }));
    let ran = false;
    const registry = createToolRegistry();
    registry.register({
      name: "bash",
      description: "bash",
      parameters: { type: "object", properties: {} },
      async execute() {
        ran = true;
        return { content: "ok" };
      },
    });
    const outcome = await pipeline.run(
      registry.get("bash"),
      { id: "c1", name: "bash", arguments: { command: "ls" } },
      undefined,
      {},
    );
    return { outcome, ran };
  }

  it("denies on exit 2 with stderr reason", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 2,
      stdout: "",
      stderr: "nope from hook",
    }));
    const { outcome, ran } = await runWithHook(runner, [
      { command: "gate.sh" },
    ]);
    expect(ran).toBe(false);
    expect(outcome.skippedBody).toBe(true);
    expect(String(outcome.result.content)).toContain("nope from hook");
    expect(runner).toHaveBeenCalledTimes(1);
    const call = runner.mock.calls[0]?.[0];
    expect(JSON.parse(call.stdin)).toMatchObject({
      hook_event_name: "PreToolUse",
      tool_name: "bash",
      tool_use_id: "c1",
      cwd: "/ws",
    });
  });

  it("denies on exit 0 JSON decision block", async () => {
    const { outcome, ran } = await runWithHook(
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ decision: "block", reason: "json block" }),
        stderr: "",
      }),
      [{ command: "gate.sh" }],
    );
    expect(ran).toBe(false);
    expect(String(outcome.result.content)).toContain("json block");
  });

  it("denies on permissionDecision deny", async () => {
    const { outcome, ran } = await runWithHook(
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            permissionDecision: "deny",
            permissionDecisionReason: "policy deny",
          },
        }),
        stderr: "",
      }),
      [{ command: "gate.sh" }],
    );
    expect(ran).toBe(false);
    expect(String(outcome.result.content)).toContain("policy deny");
  });

  it("skips unmatched matcher and fail-opens on other exits", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "warn",
    }));
    const { outcome, ran } = await runWithHook(runner, [
      { command: "only-write.sh", matcher: "write_file" },
      { command: "fail-open.sh", matcher: "bash" },
    ]);
    expect(ran).toBe(true);
    expect(outcome.skippedBody).toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0].command).toBe("fail-open.sh");
  });
});

describe("createShellHookPost", () => {
  it("blocks on exit 2 and folds additionalContext", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        additionalContext: "note from hook",
        decision: "block",
        reason: "post block",
      }),
      stderr: "",
    }));
    const pipeline = createToolPipeline();
    pipeline.onPost(
      createShellHookPost({
        commands: [{ command: "post.sh" }],
        cwd: "/ws",
        runner,
      }),
    );
    const registry = createToolRegistry();
    registry.register({
      name: "bash",
      description: "bash",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: "ok" };
      },
    });
    const outcome = await pipeline.run(
      registry.get("bash"),
      { id: "c2", name: "bash", arguments: {} },
      undefined,
      {},
    );
    expect(outcome.skippedBody).toBe(false);
    expect(String(outcome.result.content)).toContain("post block");
    expect(outcome.additionalContexts).toContain("note from hook");
    expect(JSON.parse(runner.mock.calls[0]![0].stdin)).toMatchObject({
      hook_event_name: "PostToolUse",
      tool_name: "bash",
    });
  });
});

describe("createShellLifecycleHooks", () => {
  it("fires UserPromptSubmit / PreCompact payloads", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    const life = createShellLifecycleHooks({
      config: {
        UserPromptSubmit: [{ command: "prompt.sh" }],
        PreCompact: [{ command: "compact.sh" }],
      },
      cwd: "/ws",
      sessionId: "s1",
      runner,
    });
    expect(life.has("UserPromptSubmit")).toBe(true);
    expect(life.has("Stop")).toBe(false);
    await life.run("UserPromptSubmit", { turn_id: "t1" });
    await life.run("PreCompact", { reason: "manual" });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(JSON.parse(runner.mock.calls[0]![0].stdin)).toMatchObject({
      hook_event_name: "UserPromptSubmit",
      session_id: "s1",
      turn_id: "t1",
    });
    expect(JSON.parse(runner.mock.calls[1]![0].stdin)).toMatchObject({
      hook_event_name: "PreCompact",
      reason: "manual",
    });
  });
});

describe("createPermissionRequestGate", () => {
  it("allows / denies from JSON before human UI", async () => {
    const { createPermissionRequestGate } = await import("../src/shell-hooks.js");
    const allow = createPermissionRequestGate({
      commands: [{ command: "perm.sh" }],
      cwd: "/ws",
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: "allow",
          },
        }),
        stderr: "",
      }),
    });
    await expect(
      allow({ toolName: "bash", toolInput: { command: "ls" } }),
    ).resolves.toEqual({ action: "allow" });

    const deny = createPermissionRequestGate({
      commands: [{ command: "perm.sh", matcher: "web_fetch" }],
      cwd: "/ws",
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ decision: "deny", reason: "blocked net" }),
        stderr: "",
      }),
    });
    await expect(
      deny({ toolName: "web_fetch", toolInput: { url: "https://x.test" } }),
    ).resolves.toEqual({ action: "deny", reason: "blocked net" });
  });

  it("parses PermissionRequest in hooks.json", () => {
    const config = parseShellHooksConfig({
      hooks: {
        PermissionRequest: [
          { matcher: "bash|web_fetch", hooks: [{ command: "perm.sh" }] },
        ],
        permissionRequest: [
          { hooks: [{ command: "codex-alias.sh" }] },
        ],
      },
    });
    expect(config.PermissionRequest?.map((c) => c.command)).toEqual([
      "perm.sh",
      "codex-alias.sh",
    ]);
  });
});
