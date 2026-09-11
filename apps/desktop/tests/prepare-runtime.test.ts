import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopTargetBuildPaths,
  resolveDesktopBuildTarget,
} from "../src/build-paths.js";
import {
  DESKTOP_BUNDLED_NODE_VERSION,
  DESKTOP_BUNDLED_PNPM_VERSION,
  desktopNodeArchiveName,
  parseNodeSha256Line,
  prepareDesktopRuntime,
} from "../src/prepare-runtime.js";
import { resolveDesktopPackageTarget } from "../src/package-targets.js";

describe("desktop build target selection", () => {
  it("resolves XRK_DESKTOP_TARGET and refuses deferred linux", () => {
    expect(
      resolveDesktopBuildTarget(
        { XRK_DESKTOP_TARGET: "win-x64" },
        "linux",
        "x64",
      ),
    ).toBe("win-x64");
    expect(
      resolveDesktopBuildTarget(
        { XRK_DESKTOP_TARGET: "mac-arm64" },
        "win32",
        "x64",
      ),
    ).toBe("mac-arm64");
    expect(() =>
      resolveDesktopBuildTarget(
        { XRK_DESKTOP_TARGET: "linux-x64" },
        "linux",
        "x64",
      ),
    ).toThrow(/deferred/u);
  });

  it("places runtime under .desktop-build/targets/<target>", () => {
    const appRoot = path.resolve(path.sep, "xrk-desktop-fixture", "repo", "apps", "desktop");
    const paths = desktopTargetBuildPaths("win-x64", appRoot);
    expect(paths.runtime).toBe(
      path.join(appRoot, ".desktop-build", "targets", "win-x64", "runtime"),
    );
    expect(paths.downloads).toBe(
      path.join(appRoot, ".desktop-build", "downloads"),
    );
  });
});

describe("prepareDesktopRuntime (injected)", () => {
  it("pins Node >=26 and root pnpm, writes versions.json", async () => {
    const appRoot = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-runtime-"));
    const target = resolveDesktopPackageTarget("win-x64");
    const archiveName = desktopNodeArchiveName(
      DESKTOP_BUNDLED_NODE_VERSION,
      target,
    );
    const folder = archiveName.replace(/\.zip$/u, "");
    const fakeNodeBytes = Buffer.from("fake-node-exe");
    const sha = createHash("sha256").update(fakeNodeBytes).digest("hex");

    try {
      const versions = await prepareDesktopRuntime({
        appRoot,
        targetName: "win-x64",
        skipExecutableVerify: true,
        download: async (url, destPath) => {
          mkdirSync(path.dirname(destPath), { recursive: true });
          if (url.endsWith("SHASUMS256.txt")) {
            writeFileSync(
              destPath,
              `${sha}  ${archiveName}\nother  other.zip\n`,
            );
            return;
          }
          writeFileSync(destPath, fakeNodeBytes);
        },
        extractArchive: async (_archive, destDir) => {
          const binDir = path.join(destDir, folder);
          mkdirSync(binDir, { recursive: true });
          writeFileSync(path.join(binDir, "node.exe"), fakeNodeBytes);
        },
        resolvePnpmPackage: () => {
          const pnpmDir = path.join(appRoot, "fake-pnpm");
          mkdirSync(pnpmDir, { recursive: true });
          writeFileSync(
            path.join(pnpmDir, "package.json"),
            JSON.stringify({ name: "pnpm", version: DESKTOP_BUNDLED_PNPM_VERSION }),
          );
          writeFileSync(path.join(pnpmDir, "bin.js"), "#!/usr/bin/env node\n");
          return {
            directory: pnpmDir,
            version: DESKTOP_BUNDLED_PNPM_VERSION,
          };
        },
      });

      expect(versions).toEqual({
        schemaVersion: 1,
        node: DESKTOP_BUNDLED_NODE_VERSION,
        pnpm: DESKTOP_BUNDLED_PNPM_VERSION,
        target: "win-x64",
      });
      const runtime = path.join(
        appRoot,
        ".desktop-build",
        "targets",
        "win-x64",
        "runtime",
      );
      expect(
        JSON.parse(readFileSync(path.join(runtime, "versions.json"), "utf8")),
      ).toEqual(versions);
      expect(existsSync(path.join(runtime, "node", "node.exe"))).toBe(true);
      expect(existsSync(path.join(runtime, "pnpm", "package.json"))).toBe(true);
      expect(parseNodeSha256Line(`${sha}  ${archiveName}\n`, archiveName)).toBe(
        sha,
      );
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });
});
