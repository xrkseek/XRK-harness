import { describe, expect, it } from "vitest";
import {
  SandboxDenyError,
  createDenyListSandbox,
  createPermissiveSandbox,
  createSandboxWrapGuard,
  createWorkspaceSandbox,
} from "../src/index.js";

describe("sandbox", () => {
  it("permissive returns same argv", () => {
    const s = createPermissiveSandbox();
    expect(s.wrapArgv(["echo", "hi"])).toEqual(["echo", "hi"]);
  });

  it("deny list hits rm -rf /", () => {
    const s = createDenyListSandbox();
    expect(() => s.wrapArgv(["bash", "-lc", "rm -rf /"])).toThrow(
      SandboxDenyError,
    );
  });

  it("workspace sandbox rejects cwd escape", () => {
    const s = createWorkspaceSandbox({ root: process.cwd() });
    expect(() => s.wrapArgv(["echo"], "/")).toThrow(/escapes/);
  });

  it("guard denies bash when deny list hits", async () => {
    const guard = createSandboxWrapGuard(
      createDenyListSandbox({
        inner: createPermissiveSandbox(),
      }),
    );
    const verdict = await guard({
      call: { id: "1", name: "bash", arguments: { command: "rm -rf /" } },
      args: { command: "rm -rf /" },
      stage: "guards",
      skippedBody: false,
      additionalContexts: [],
      metrics: { calls: 0, retries: 0 },
      toolEvents: [],
    });
    expect(verdict).toBe("deny");
  });
});
