import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_APP_UPDATE_YML,
  isDesktopUpdateFeedEnabled,
  writeDesktopAppUpdateConfig,
} from "../src/app-update-config.js";
import {
  DESKTOP_AUTO_UPDATE_ENV,
  desktopElectronBuilderPublish,
  renderDesktopAppUpdateYml,
  resolveDesktopAutoUpdateConfig,
} from "../src/desktop-auto-update-environment.js";
import {
  DESKTOP_UNSIGNED_ENV,
  describeDesktopSigningPlan,
  isDesktopMacOSNotarizationReady,
  isDesktopUnsignedRequested,
  resolveDesktopMacOSSigningEnvironment,
  resolveDesktopWindowsSigningEnvironment,
} from "../src/desktop-signing-environment.js";
import {
  assertDesktopWindowsSigningReady,
  buildDesktopWindowsSigningEnvironment,
  createDesktopWindowsTokenSigner,
  createRedactedWindowsSigningError,
  isDesktopWindowsTokenSigningReady,
  resolveDesktopWindowsCertificateFile,
  resolveDesktopWindowsUpdatePublisher,
  scrubDesktopSigningEnvironment,
} from "../src/windows-sign.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktop signing environment", () => {
  it("parses unsigned flag and Windows certificate gate", () => {
    expect(isDesktopUnsignedRequested({})).toBe(false);
    expect(isDesktopUnsignedRequested({ [DESKTOP_UNSIGNED_ENV]: "1" })).toBe(
      true,
    );
    expect(() =>
      isDesktopUnsignedRequested({ [DESKTOP_UNSIGNED_ENV]: "maybe" }),
    ).toThrow(/0 or 1/);
    expect(resolveDesktopWindowsSigningEnvironment({})).toBeUndefined();
    expect(
      resolveDesktopWindowsSigningEnvironment({
        XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
        XRK_DESKTOP_WINDOWS_TOKEN_PIN: "pin",
      }),
    ).toEqual({
      certificateFile: "C:\\release\\server.cer",
      tokenPin: "pin",
    });
    expect(
      resolveDesktopWindowsSigningEnvironment({
        [DESKTOP_UNSIGNED_ENV]: "1",
        XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
      }),
    ).toBeUndefined();
  });

  it("rejects unsigned on macOS and detects notarization readiness", () => {
    expect(() =>
      resolveDesktopMacOSSigningEnvironment({ [DESKTOP_UNSIGNED_ENV]: "1" }),
    ).toThrow(/Windows-only/);
    const signing = resolveDesktopMacOSSigningEnvironment({
      XRK_DESKTOP_MACOS_IDENTITY: "Developer ID Application: Example",
      XRK_DESKTOP_MACOS_APPLE_ID: "a@example.com",
      XRK_DESKTOP_MACOS_APPLE_ID_PASSWORD: "@keychain:AC",
      XRK_DESKTOP_MACOS_TEAM_ID: "TEAMID",
    });
    expect(signing?.signingIdentity).toContain("Developer ID");
    expect(isDesktopMacOSNotarizationReady(signing)).toBe(true);
    expect(
      isDesktopMacOSNotarizationReady({
        signingIdentity: "Developer ID Application: Example",
      }),
    ).toBe(false);
  });

  it("describes signing plan and rejects incomplete Windows token identity", () => {
    expect(
      describeDesktopSigningPlan(
        { [DESKTOP_UNSIGNED_ENV]: "1", XRK_DESKTOP_TARGET: "win-x64" },
        "win32",
      ),
    ).toEqual({
      mode: "unsigned",
      notarize: false,
      forceCodeSigning: false,
    });
    expect(
      describeDesktopSigningPlan({ XRK_DESKTOP_TARGET: "win-x64" }, "win32"),
    ).toEqual({ mode: "none", notarize: false, forceCodeSigning: false });
    expect(() =>
      describeDesktopSigningPlan(
        {
          XRK_DESKTOP_TARGET: "win-x64",
          XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
        },
        "win32",
      ),
    ).toThrow(/SignTool \+ token PIN/);
    expect(
      describeDesktopSigningPlan(
        {
          XRK_DESKTOP_TARGET: "win-x64",
          XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
          XRK_DESKTOP_WINDOWS_SIGNTOOL: "C:\\tools\\signtool.exe",
          XRK_DESKTOP_WINDOWS_TOKEN_PIN: "pin",
          XRK_DESKTOP_WINDOWS_KEY_CONTAINER: "container",
        },
        "win32",
      ),
    ).toEqual({
      mode: "windows-token",
      notarize: false,
      forceCodeSigning: true,
    });
    expect(
      describeDesktopSigningPlan(
        {
          XRK_DESKTOP_TARGET: "mac-arm64",
          XRK_DESKTOP_MACOS_IDENTITY: "Developer ID Application: Example",
          XRK_DESKTOP_MACOS_APPLE_ID: "a@example.com",
          XRK_DESKTOP_MACOS_APPLE_ID_PASSWORD: "pw",
          XRK_DESKTOP_MACOS_TEAM_ID: "TEAM",
        },
        "darwin",
      ),
    ).toEqual({
      mode: "macos-identity",
      notarize: true,
      forceCodeSigning: true,
    });
  });
});

describe("desktop Windows token signing", () => {
  const cerPath = fileURLToPath(
    new URL("./fixtures/test-codesign.cer", import.meta.url),
  );

  it("loads Code Signing leaf and builds publisherName", () => {
    const resolved = resolveDesktopWindowsCertificateFile(cerPath);
    expect(resolved.certificate.ca).toBe(false);
    expect(resolved.thumbprint.length).toBeGreaterThan(8);
    const publisher = resolveDesktopWindowsUpdatePublisher(cerPath);
    expect(publisher).toContain("CN=");
    expect(publisher).toContain("O=");
    expect(publisher).toContain("C=");
  });

  it("scrubs secrets and builds CMD signing environment", () => {
    expect(
      scrubDesktopSigningEnvironment({
        XRK_DESKTOP_WINDOWS_TOKEN_PIN: "secret",
        OPENAI_API_KEY: "sk",
        PATH: "/usr/bin",
        XRK_DESKTOP_AUTO_UPDATE_ENV: "test",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      XRK_DESKTOP_AUTO_UPDATE_ENV: "test",
    });
    const env = buildDesktopWindowsSigningEnvironment(
      { PATH: "C:\\Windows" },
      {
        certificateFile: "C:\\a.cer",
        signTool: "C:\\signtool.exe",
        path: "C:\\out.exe",
        isNest: false,
        tokenPin: "pin",
        keyContainer: "kc",
      },
    );
    expect(env.XRK_DESKTOP_WINDOWS_SIGN_TARGET).toBe("C:\\out.exe");
    expect(env.XRK_DESKTOP_WINDOWS_TOKEN_PIN).toBe("pin");
  });

  it("asserts token readiness and redacts PIN in failures", () => {
    expect(
      isDesktopWindowsTokenSigningReady({
        certificateFile: cerPath,
        signTool: "C:\\missing-signtool.exe",
        tokenPin: "super-secret-pin",
        keyContainer: "kc",
      }),
    ).toBe(true);
    expect(() =>
      assertDesktopWindowsSigningReady({
        certificateFile: cerPath,
      }),
    ).toThrow(/TOKEN_PIN/);
    const err = createRedactedWindowsSigningError(
      { code: 1, stderr: "failed with super-secret-pin" },
      "C:\\app.exe",
      ["super-secret-pin"],
    );
    expect(err.message).toContain("<redacted>");
    expect(err.message).not.toContain("super-secret-pin");
    expect(() =>
      createDesktopWindowsTokenSigner({
        certificateFile: cerPath,
        signTool: cerPath,
        tokenPin: "pin",
        keyContainer: "kc",
      }),
    ).toThrow(/SIGNTOOL/);
  });

  it("invokes custom sign hook via injected exec", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const dir = mkdtempSync(join(tmpdir(), "xrk-sign-"));
    tempDirs.push(dir);
    const fakeTool = join(dir, "signtool.exe");
    writeFileSync(fakeTool, "stub");
    const hook = createDesktopWindowsTokenSigner({
      certificateFile: cerPath,
      signTool: fakeTool,
      tokenPin: "pin-value",
      keyContainer: "container",
      execFile: async (file, args) => {
        calls.push({ file: String(file), args: args as string[] });
        return { stdout: Buffer.from(""), stderr: Buffer.from("") };
      },
    });
    await hook({ path: "C:\\App.exe", hash: "sha256", isNest: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain("windows-sign.cmd");
    await expect(
      hook({ path: "C:\\App.exe", hash: "sha1", isNest: false }),
    ).rejects.toThrow(/SHA-256/);
  });
});

describe("desktop auto-update environment", () => {
  it("resolves generic feed URL for supported targets", () => {
    expect(
      resolveDesktopAutoUpdateConfig(
        { [DESKTOP_AUTO_UPDATE_ENV]: "test" },
        "win32",
        "x64",
      ),
    ).toBeUndefined();
    const update = resolveDesktopAutoUpdateConfig(
      {
        [DESKTOP_AUTO_UPDATE_ENV]: "test",
        XRK_DESKTOP_UPDATE_TEST_ORIGIN: "https://updates.example.test/",
      },
      "win32",
      "x64",
    );
    expect(update).toEqual({
      channel: "test",
      publicUrl: "https://updates.example.test/desktop/win-x64",
      metadataChannel: "nightly",
    });
    expect(
      resolveDesktopAutoUpdateConfig(
        {
          [DESKTOP_AUTO_UPDATE_ENV]: "test",
          XRK_DESKTOP_UPDATE_TEST_ORIGIN: "https://updates.example.test/",
        },
        "darwin",
        "x64",
      )?.publicUrl,
    ).toBe("https://updates.example.test/desktop/mac-x64");
    expect(desktopElectronBuilderPublish(update)).toEqual([
      {
        provider: "generic",
        url: "https://updates.example.test/desktop/win-x64",
        channel: "nightly",
      },
    ]);
    expect(desktopElectronBuilderPublish(undefined)).toBeNull();
    expect(renderDesktopAppUpdateYml(update!)).toContain("provider: generic");
  });

  it("writes app-update.yml and gates feed enablement", () => {
    const dir = mkdtempSync(join(tmpdir(), "xrk-desktop-update-"));
    tempDirs.push(dir);
    const update = {
      channel: "test" as const,
      publicUrl: "https://updates.example.test/desktop/mac-arm64",
      metadataChannel: "nightly" as const,
    };
    const written = writeDesktopAppUpdateConfig(dir, update);
    expect(written.endsWith(DESKTOP_APP_UPDATE_YML)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain(update.publicUrl);
    expect(
      isDesktopUpdateFeedEnabled({
        isPackaged: true,
        resourcesPath: dir,
      }),
    ).toBe(true);
    expect(
      isDesktopUpdateFeedEnabled({
        isPackaged: false,
        resourcesPath: dir,
      }),
    ).toBe(false);
  });
});
