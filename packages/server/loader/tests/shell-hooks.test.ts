/** Shell PreToolUse hooks: exit 2 / JSON deny block; matcher + fail-open. */
import { describe, expect, it, vi } from "vitest";
import {
  createShellHookPre,
  loadShellHookCommands,
  parsePreToolUseHooks,
  toolNameMatches,
} from "../src/shell-hooks.js";
import { createToolPipeline, createToolRegistry } from "@xrkseek/core-tools";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parsePreToolUseHooks", () => {
  it("reads Claude-style PreToolUse command groups only", () => {
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
        PreToolUse: [
          { hooks: [{ command: "deny.sh" }] },
        ],
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

describe("loadShellHookCommands", () => {
  it("skips missing files and loads a valid hooks.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-hooks-"));
    const file = path.join(dir, "hooks.json");
    writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ command: "echo ok" }] }],
        },
      }),
    );
    expect(loadShellHookCommands([path.join(dir, "missing.json"), file])).toEqual([
      { command: "echo ok" },
    ]);
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
