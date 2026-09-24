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
});
