import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => undefined;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }),
  };
});

import {
  hostListOpenInApps,
  hostOpenInApp,
  isSshLaunchEnv,
  isWindowsAppsAliasPath,
  listInstalledOpenInApps,
  resetOpenInAppCache,
  resolveOpenInAppArgv,
} from "../src/host-open-in-app.js";

describe("host open-in-app", () => {
  beforeEach(() => {
    resetOpenInAppCache();
  });

  it("SSH launch env hides the catalog", () => {
    expect(isSshLaunchEnv({ SSH_CONNECTION: "1 2 3 4" })).toBe(true);
    expect(
      listInstalledOpenInApps(process.platform, {
        ...process.env,
        SSH_CONNECTION: "1 2 3 4",
        XRK_NATIVE_OPEN: "1",
      }),
    ).toEqual([]);
  });

  it("listOpenInApps returns apps when native open is allowed", async () => {
    resetOpenInAppCache();
    const listed = await hostListOpenInApps();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    // At least the platform file manager when canOpenNativePath is true.
    if (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux") {
      expect(listed.value.apps.length).toBeGreaterThan(0);
      const fm =
        process.platform === "darwin"
          ? "finder"
          : process.platform === "win32"
            ? "explorer"
            : "filemanager";
      expect(listed.value.apps).toContain(fm);
    }
  });

  it("openInApp rejects relative paths", async () => {
    const res = await hostOpenInApp({ app: "explorer", path: "relative" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("invalid-payload");
  });

  it("openInApp rejects missing directories", async () => {
    const missing = path.join(tmpdir(), `xrk-open-in-missing-${Date.now()}`);
    const res = await hostOpenInApp({
      app: process.platform === "darwin" ? "finder" : process.platform === "win32" ? "explorer" : "filemanager",
      path: missing,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("not-found");
  });

  it("openInApp rejects a file path (workspace must be a directory)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-open-in-file-"));
    try {
      const file = path.join(root, "note.txt");
      await writeFile(file, "x");
      const app =
        process.platform === "darwin"
          ? "finder"
          : process.platform === "win32"
            ? "explorer"
            : "filemanager";
      const res = await hostOpenInApp({ app, path: file });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("invalid-payload");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("openInApp accepts an existing directory for the file manager", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-open-in-"));
    try {
      const app =
        process.platform === "darwin"
          ? "finder"
          : process.platform === "win32"
            ? "explorer"
            : "filemanager";
      const res = await hostOpenInApp({ app, path: root });
      if (res.ok) {
        expect(res.value.opened).toBe(true);
      } else {
        expect(res.error.code).toBe("not-implemented");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("openInApp normalizes trailing slash-dot before existence checks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-open-in-dot-"));
    try {
      const app =
        process.platform === "darwin"
          ? "finder"
          : process.platform === "win32"
            ? "explorer"
            : "filemanager";
      const noisy = `${root}${process.platform === "win32" ? "\\." : "/."}`;
      const res = await hostOpenInApp({ app, path: noisy });
      if (res.ok) {
        expect(res.value.opened).toBe(true);
      } else {
        expect(res.error.code).toBe("not-implemented");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("WindowsApps alias paths are detected", () => {
    expect(
      isWindowsAppsAliasPath(
        "C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      ),
    ).toBe(true);
    expect(
      isWindowsAppsAliasPath("C:\\Program Files\\Windows Terminal\\wt.exe"),
    ).toBe(false);
  });

  it("Windows Terminal resolves to wt -d with windowsHide false (no -w new, no Apps path)", () => {
    if (process.platform !== "win32") return;
    resetOpenInAppCache();
    if (!listInstalledOpenInApps().includes("windowsterminal")) return;
    const workspace = path.join(tmpdir(), "xrk-wt-workspace");
    const resolved = resolveOpenInAppArgv("windowsterminal", workspace, "win32");
    expect(resolved).toBeDefined();
    expect(isWindowsAppsAliasPath(resolved!.command)).toBe(false);
    expect(resolved!.command === "wt" || resolved!.command.toLowerCase().endsWith("wt.exe")).toBe(
      true,
    );
    expect(resolved!.args).toEqual(["-d", workspace]);
    expect(resolved!.args).not.toContain("-w");
    expect(resolved!.windowsHide).toBe(false);
  });

  it("Cursor on Windows prefers Cursor.exe over PATH shim when both exist", () => {
    if (process.platform !== "win32") return;
    resetOpenInAppCache();
    if (!listInstalledOpenInApps().includes("cursor")) return;
    const workspace = path.join(tmpdir(), "xrk-cursor-workspace");
    const resolved = resolveOpenInAppArgv("cursor", workspace, "win32");
    expect(resolved).toBeDefined();
    expect(isWindowsAppsAliasPath(resolved!.command)).toBe(false);
    // Prefer real install path when present; bare "cursor" only if no .exe probe hit.
    const cmd = resolved!.command.toLowerCase();
    if (cmd !== "cursor") {
      expect(cmd.endsWith("cursor.exe")).toBe(true);
    }
    expect(resolved!.args).toEqual([workspace]);
  });
});
