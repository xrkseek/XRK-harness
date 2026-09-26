import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDesktopPackageSigningFiles,
  desktopPackageEnvironmentPath,
  loadDesktopPackageEnvironment,
  tryLoadDesktopPackageEnvironment,
} from "../src/desktop-package-environment.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktop package environment", () => {
  it("returns undefined when dotenv is missing", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "xrk-desktop-env-missing-"));
    tempDirs.push(appRoot);
    expect(
      tryLoadDesktopPackageEnvironment("win32", { PATH: "/usr/bin" }, appRoot),
    ).toBeUndefined();
    expect(desktopPackageEnvironmentPath("win32", appRoot)).toBe(
      join(appRoot, ".env.windows"),
    );
  });

  it("loads .env.windows and strips ambient XRK_DESKTOP_* secrets", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "xrk-desktop-env-"));
    tempDirs.push(appRoot);
    writeFileSync(
      join(appRoot, ".env.windows"),
      [
        "XRK_DESKTOP_AUTO_UPDATE_ENV=test",
        "XRK_DESKTOP_WINDOWS_SIGNTOOL=signtool.exe",
        "XRK_DESKTOP_WINDOWS_CER_FILE=leaf.cer",
        "XRK_DESKTOP_WINDOWS_KEY_CONTAINER=container",
        "XRK_DESKTOP_WINDOWS_TOKEN_PIN=secret-pin",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(appRoot, "leaf.cer"), "not-a-real-cert\n", "utf8");
    writeFileSync(join(appRoot, "signtool.exe"), "fake\n", "utf8");

    const loaded = loadDesktopPackageEnvironment(
      "win32",
      {
        PATH: "/usr/bin",
        XRK_DESKTOP_WINDOWS_TOKEN_PIN: "ambient-must-not-win",
        XRK_DESKTOP_UPDATE_TEST_ORIGIN: "https://ambient.example",
        XRK_DESKTOP_UNSIGNED: "1",
      },
      appRoot,
    );
    expect(loaded.PATH).toBe("/usr/bin");
    expect(loaded.XRK_DESKTOP_WINDOWS_TOKEN_PIN).toBe("secret-pin");
    expect(loaded.XRK_DESKTOP_UPDATE_TEST_ORIGIN).toBeUndefined();
    expect(loaded.XRK_DESKTOP_UNSIGNED).toBe("1");
    expect(loaded.XRK_DESKTOP_WINDOWS_CER_FILE).toBe(
      join(appRoot, "leaf.cer"),
    );
    expect(loaded.XRK_DESKTOP_WINDOWS_SIGNTOOL).toBe(
      join(appRoot, "signtool.exe"),
    );
    expect(() => assertDesktopPackageSigningFiles(loaded)).not.toThrow();
  });

  it("keeps file UNSIGNED when ambient omits it", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "xrk-desktop-env-unsigned-"));
    tempDirs.push(appRoot);
    writeFileSync(
      join(appRoot, ".env.windows"),
      "XRK_DESKTOP_UNSIGNED=1\nXRK_DESKTOP_AUTO_UPDATE_ENV=test\n",
      "utf8",
    );
    const loaded = loadDesktopPackageEnvironment("win32", { PATH: "/bin" }, appRoot);
    expect(loaded.XRK_DESKTOP_UNSIGNED).toBe("1");
  });

  it("rejects unknown keys", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "xrk-desktop-env-bad-"));
    tempDirs.push(appRoot);
    writeFileSync(
      join(appRoot, ".env.windows"),
      "NOT_A_DESKTOP_KEY=1\n",
      "utf8",
    );
    expect(() =>
      loadDesktopPackageEnvironment("win32", {}, appRoot),
    ).toThrow(/unsupported setting/u);
  });
});
