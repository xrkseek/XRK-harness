import { describe, expect, it, vi } from "vitest";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "@xrkseek/core-tools";
import {
  createHardlineArgvPre,
  matchHardlineArgv,
} from "../src/hardline.js";

describe("hardline argv", () => {
  it("matches root wipe and spares prose", () => {
    expect(matchHardlineArgv("rm -rf /")?.reason).toMatch(/root/);
    expect(matchHardlineArgv("echo never shutdown the box")).toBeUndefined();
    expect(matchHardlineArgv("shutdown -h now")?.reason).toMatch(/shutdown/);
    expect(matchHardlineArgv("dd if=/dev/zero of=/dev/sda")?.reason).toMatch(
      /block/,
    );
  });

  it("blocks indiscriminate node kills, allows precise PID kills", () => {
    const crashCmd =
      "Get-Process node -EA SilentlyContinue | Where-Object { $_.Path -like '*node*' } | Stop-Process -Force -EA SilentlyContinue";
    expect(matchHardlineArgv(crashCmd)?.reason).toMatch(/Get-Process node/i);
    expect(
      matchHardlineArgv("Stop-Process -Name node -Force")?.reason,
    ).toMatch(/Stop-Process by name/i);
    expect(matchHardlineArgv("taskkill /IM node.exe /F")?.reason).toMatch(
      /taskkill/i,
    );
    expect(matchHardlineArgv("killall -9 node")?.reason).toMatch(/killall/i);
    expect(matchHardlineArgv("pkill -f node")?.reason).toMatch(/pkill|killall/i);
    // Precise job teardown must remain allowed.
    expect(matchHardlineArgv("Stop-Process -Id 47268 -Force")).toBeUndefined();
    expect(matchHardlineArgv("taskkill /PID 47268 /T /F")).toBeUndefined();
  });

  it("createHardlineArgvPre denies bash before body", async () => {
    const body = vi.fn(async () => ({ content: "ran" }));
    const reg = createToolRegistry();
    reg.register({
      name: "bash",
      description: "shell",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(createHardlineArgvPre());
    // Policy would allow — hardline still wins when registered first.
    pipeline.onPre(() => ({ action: "continue", args: { command: "rm -rf /" } }));
    const out = await runToolDetailed({
      registry: reg,
      call: {
        id: "1",
        name: "bash",
        arguments: { command: "rm -rf /" },
      },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.skippedBody).toBe(true);
    expect(String(out.result.content)).toMatch(/hardline/i);
  });

  it("createHardlineArgvPre denies terminal_send text", async () => {
    const body = vi.fn(async () => ({ content: "sent" }));
    const reg = createToolRegistry();
    reg.register({
      name: "terminal_send",
      description: "pty",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(createHardlineArgvPre());
    const out = await runToolDetailed({
      registry: reg,
      call: {
        id: "2",
        name: "terminal_send",
        arguments: {
          text: "Get-Process node | Stop-Process -Force",
        },
      },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.skippedBody).toBe(true);
    expect(String(out.result.content)).toMatch(/hardline/i);
  });
});
