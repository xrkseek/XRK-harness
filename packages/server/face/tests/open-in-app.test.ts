import { describe, expect, it, beforeEach } from "vitest";
import {
  isSshLaunchEnv,
  listInstalledOpenInApps,
  resetOpenInAppCache,
  hostListOpenInApps,
  hostOpenInApp,
} from "../src/host-open-in-app.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

  it("openInApp accepts an existing directory for the file manager (spawn may no-op in CI)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-open-in-"));
    try {
      const app =
        process.platform === "darwin"
          ? "finder"
          : process.platform === "win32"
            ? "explorer"
            : "filemanager";
      const res = await hostOpenInApp({ app, path: root });
      // Desktop CI may lack a display; accept ok or spawn-level internal.
      if (res.ok) {
        expect(res.value.opened).toBe(true);
      } else {
        expect(["internal", "not-implemented"]).toContain(res.error.code);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
