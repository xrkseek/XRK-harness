import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SandboxBackendError,
  SandboxDenyError,
  createDenyListSandbox,
  createSandboxStack,
  createWindowsSandbox,
  isWindowsSandboxMode,
  resolveWindowsSandboxHelper,
  windowsSandboxCapability,
} from "../src/index.js";

const ROOT = path.resolve("/tmp/xrk-win-ws");
const HELPER = "xrk-windows-sandbox-helper";

describe("createWindowsSandbox", () => {
  it("fails closed on non-Windows hosts", () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "linux",
    });
    expect(() => s.wrapArgv(["true"], ROOT)).toThrow(SandboxBackendError);
    expect(() => s.wrapArgv(["true"], ROOT)).toThrow(/only available on Windows/);
    expect(() => s.wrapArgv(["true"], ROOT)).toThrow(/SANDBOX_PLATFORM|Windows/);
  });

  it("fails closed when the helper runtime is missing", () => {
    expect(() => createWindowsSandbox({ workspaceRoot: ROOT, helper: "  " })).toThrow(
      SandboxBackendError,
    );
    expect(() => createWindowsSandbox({ workspaceRoot: ROOT, helper: "" })).toThrow(
      /SANDBOX_UNAVAILABLE|helper binary/,
    );
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      createWindowsSandbox({
        workspaceRoot: ROOT,
        helper: HELPER,
        mode: "yolo" as never,
      }),
    ).toThrow(/unknown windows sandbox mode/);
  });

  it("emits the documented helper argv contract", async () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
      networkAccess: false,
    });
    const argv = await s.confine(["bash", "-lc", "echo hi"], ROOT);

    expect(argv[0]).toBe(HELPER);
    expect(argv[argv.indexOf("--mode") + 1]).toBe("workspace-write");
    expect(argv[argv.indexOf("--cwd") + 1]).toBe(ROOT);
    expect(argv).toContain("--no-network");
    expect(argv[argv.indexOf("--writable-root") + 1]).toBe(ROOT);
    // workspace stays writable in workspace-write mode
    expect(argv).not.toContain("--read-only-root");
    // original argv is passed through after the separator
    const sep = argv.indexOf("--");
    expect(sep).toBeGreaterThan(0);
    expect(argv.slice(sep + 1)).toEqual(["bash", "-lc", "echo hi"]);
  });

  it("honors network access and extra writable roots", async () => {
    const extra = path.resolve("/tmp/xrk-win-cache");
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
      networkAccess: true,
      writableRoots: [extra],
    });
    const argv = await s.confine(["true"], ROOT);
    expect(argv).toContain("--network");
    expect(argv).not.toContain("--no-network");
    const roots = argv
      .map((v, i) => (v === "--writable-root" ? argv[i + 1] : undefined))
      .filter((v): v is string => v !== undefined);
    expect(roots).toEqual([ROOT, extra]);
  });

  it("read-only mode pins the workspace as a read-only root", async () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
      mode: "read-only",
    });
    const argv = await s.confine(["true"], ROOT);
    expect(argv[argv.indexOf("--mode") + 1]).toBe("read-only");
    expect(argv[argv.indexOf("--read-only-root") + 1]).toBe(ROOT);
    expect(argv).not.toContain("--writable-root");
  });

  it("keeps the workspace writable under danger-full-access", async () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
      mode: "danger-full-access",
    });
    const argv = await s.confine(["true"], ROOT);
    expect(argv[argv.indexOf("--writable-root") + 1]).toBe(ROOT);
  });

  it("rejects a cwd escaping the workspace root", () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
    });
    expect(() => s.wrapArgv(["true"], path.resolve("/tmp"))).toThrow(/escapes/);
  });

  it("applies the inner deny-list before helper wrapping", () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
      inner: createDenyListSandbox(),
    });
    expect(() => s.wrapArgv(["bash", "-lc", "rm -rf /"], ROOT)).toThrow(
      SandboxDenyError,
    );
  });

  it("propagates abort on confine", async () => {
    const s = createWindowsSandbox({
      workspaceRoot: ROOT,
      helper: HELPER,
      platform: "win32",
    });
    const signal = AbortSignal.abort(new Error("cancel windows confine"));
    await expect(s.confine(["true"], ROOT, signal)).rejects.toThrow(
      /cancel windows confine/,
    );
  });
});

describe("isWindowsSandboxMode", () => {
  it("accepts the three permission postures only", () => {
    expect(isWindowsSandboxMode("read-only")).toBe(true);
    expect(isWindowsSandboxMode("workspace-write")).toBe(true);
    expect(isWindowsSandboxMode("danger-full-access")).toBe(true);
    expect(isWindowsSandboxMode("workspace")).toBe(false);
    expect(isWindowsSandboxMode(undefined)).toBe(false);
  });
});

describe("resolveWindowsSandboxHelper", () => {
  it("reads XRK_SANDBOX_WINDOWS_HELPER and trims blanks", () => {
    expect(
      resolveWindowsSandboxHelper({ XRK_SANDBOX_WINDOWS_HELPER: "  h.exe " }),
    ).toBe("h.exe");
    expect(resolveWindowsSandboxHelper({ XRK_SANDBOX_WINDOWS_HELPER: "   " })).toBe(
      undefined,
    );
    expect(resolveWindowsSandboxHelper({})).toBeUndefined();
  });
});

describe("windowsSandboxCapability", () => {
  it("reports unavailable off Windows", () => {
    const cap = windowsSandboxCapability({ platform: "linux" });
    expect(cap.available).toBe(false);
    expect(cap.reason).toMatch(/only available on Windows/);
  });

  it("reports unavailable without a helper", () => {
    const cap = windowsSandboxCapability({ platform: "win32", env: {} });
    expect(cap.available).toBe(false);
    expect(cap.reason).toMatch(/XRK_SANDBOX_WINDOWS_HELPER/);
  });

  it("reports unavailable when a helper path does not exist", () => {
    const cap = windowsSandboxCapability({
      platform: "win32",
      helper: path.resolve("/tmp/definitely-missing-helper.exe"),
    });
    expect(cap.available).toBe(false);
    expect(cap.reason).toMatch(/not found/);
  });

  it("accepts a bare helper command name resolved via PATH", () => {
    const cap = windowsSandboxCapability({
      platform: "win32",
      helper: "xrk-windows-sandbox-helper",
    });
    expect(cap.available).toBe(true);
    expect(cap.helper).toBe("xrk-windows-sandbox-helper");
  });
});

describe("createSandboxStack windows backend", () => {
  it("fails closed without a helper instead of degrading to bare argv", () => {
    expect(() =>
      createSandboxStack({
        workspaceRoot: process.cwd(),
        backend: "windows",
        env: {},
      }),
    ).toThrow(SandboxBackendError);
    expect(() =>
      createSandboxStack({
        workspaceRoot: process.cwd(),
        backend: "windows",
        env: {},
      }),
    ).toThrow(/SANDBOX_UNAVAILABLE|XRK_SANDBOX_WINDOWS_HELPER/);
  });

  it("builds helper argv from env when configured", async () => {
    const s = createSandboxStack({
      workspaceRoot: process.cwd(),
      backend: "windows",
      env: {
        XRK_SANDBOX_WINDOWS_HELPER: HELPER,
        XRK_SANDBOX_WINDOWS_MODE: "read-only",
      },
    });
    // Platform guard applies at wrap time; on non-Windows this is the
    // documented fail-closed path rather than a silent pass-through.
    if (process.platform !== "win32") {
      expect(() => s.wrapArgv(["true"], process.cwd())).toThrow(
        /only available on Windows/,
      );
      return;
    }
    const argv = await s.confine(["true"], process.cwd());
    expect(argv[0]).toBe(HELPER);
    expect(argv[argv.indexOf("--mode") + 1]).toBe("read-only");
  });

  it("rejects an invalid mode from env", () => {
    expect(() =>
      createSandboxStack({
        workspaceRoot: process.cwd(),
        backend: "windows",
        env: {
          XRK_SANDBOX_WINDOWS_HELPER: HELPER,
          XRK_SANDBOX_WINDOWS_MODE: "nope",
        },
      }),
    ).toThrow(/unknown windows sandbox mode/);
  });
});
