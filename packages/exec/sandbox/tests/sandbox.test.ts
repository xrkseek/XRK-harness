import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SandboxBackendError,
  SandboxDenyError,
  createBubblewrapSandbox,
  createDenyListSandbox,
  createDockerSandbox,
  createPermissiveSandbox,
  createSandboxStack,
  createSandboxWrapGuard,
  createWorkspaceSandbox,
  hostPathForDockerMount,
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
      safetyNotices: [],
      metrics: { calls: 0, retries: 0 },
      toolEvents: [],
    });
    expect(verdict).toBe("deny");
  });

  it("confine honors abort before wrap", async () => {
    const s = createPermissiveSandbox();
    const signal = AbortSignal.abort(new Error("cancel confine"));
    await expect(s.confine(["echo", "hi"], undefined, signal)).rejects.toThrow(
      /cancel confine/,
    );
  });

  it("confine returns wrapped argv when not aborted", async () => {
    const s = createWorkspaceSandbox({
      root: process.cwd(),
      inner: createDenyListSandbox(),
    });
    await expect(s.confine(["echo", "ok"])).resolves.toEqual(["echo", "ok"]);
  });
});

describe("createDockerSandbox", () => {
  const root = path.resolve("/tmp/xrk-sandbox-ws");

  it("rewrites argv to docker run with workspace mount", async () => {
    const s = createDockerSandbox({
      workspaceRoot: root,
      image: "node:22-bookworm",
      network: "none",
    });
    const argv = await s.confine(["bash", "-lc", "echo hi"], root);
    expect(argv[0]).toBe("docker");
    expect(argv).toContain("run");
    expect(argv).toContain("--rm");
    expect(argv).toContain("node:22-bookworm");
    expect(argv).toContain("bash");
    const vIdx = argv.indexOf("-v");
    expect(vIdx).toBeGreaterThan(0);
    expect(String(argv[vIdx + 1])).toContain(":/workspace");
  });

  it("deny-list still applies before docker wrap", () => {
    const s = createDockerSandbox({
      workspaceRoot: root,
      image: "alpine",
      inner: createDenyListSandbox(),
    });
    expect(() => s.wrapArgv(["bash", "-lc", "rm -rf /"], root)).toThrow(
      SandboxDenyError,
    );
  });

  it("maps Windows drive letters for mounts", () => {
    if (process.platform !== "win32") {
      expect(hostPathForDockerMount("/tmp/ws")).toBe(path.resolve("/tmp/ws"));
      return;
    }
    const mapped = hostPathForDockerMount("C:\\Users\\demo\\ws");
    expect(mapped.toLowerCase()).toMatch(/^\/c\/users\/demo\/ws$/i);
  });
});

describe("createSandboxStack", () => {
  it("defaults to workspace+deny (no docker argv)", async () => {
    const s = createSandboxStack({
      workspaceRoot: process.cwd(),
      backend: "workspace",
      env: {},
    });
    await expect(s.confine(["echo", "x"])).resolves.toEqual(["echo", "x"]);
  });

  it("docker backend requires image", () => {
    expect(() =>
      createSandboxStack({
        workspaceRoot: process.cwd(),
        backend: "docker",
        env: {},
      }),
    ).toThrow(SandboxBackendError);
  });

  it("docker backend from env image", async () => {
    const s = createSandboxStack({
      workspaceRoot: process.cwd(),
      backend: "docker",
      env: { XRK_SANDBOX_DOCKER_IMAGE: "alpine:3.20" },
    });
    const argv = await s.confine(["true"]);
    expect(argv[0]).toBe("docker");
    expect(argv).toContain("alpine:3.20");
  });
});

describe("createBubblewrapSandbox", () => {
  it("fails closed off Linux", () => {
    if (process.platform === "linux") return;
    const s = createBubblewrapSandbox({ workspaceRoot: process.cwd() });
    expect(() => s.wrapArgv(["true"])).toThrow(/Linux/);
  });
});
