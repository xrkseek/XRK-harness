import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_AUTO_UPDATE_ENV,
  desktopPackageCompleteFilename,
  resolveDesktopUploadConfig,
} from "../src/desktop-auto-update-environment.js";
import {
  createDesktopUploadPlan,
  parseDesktopUpdateMetadataYaml,
} from "../src/desktop-upload-plan.js";
import {
  createDesktopFilesystemUploadTransport,
  uploadDesktopRelease,
} from "../src/desktop-upload-run.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha512Base64(body: Buffer): string {
  return createHash("sha512").update(body).digest("base64");
}

function testUploadEnv(): NodeJS.ProcessEnv {
  return {
    [DESKTOP_AUTO_UPDATE_ENV]: "test",
    XRK_DESKTOP_UPDATE_TEST_ORIGIN: "https://updates.example.test",
    XRK_DESKTOP_UPLOAD_TEST_BUCKET: "xrk-desktop-test",
    XRK_DESKTOP_UPLOAD_TEST_SECRET_ID: "test-id",
    XRK_DESKTOP_UPLOAD_TEST_SECRET_KEY: "test-key",
  };
}

function seedWinX64Artifacts(
  artifactsRoot: string,
  version: string,
  options: { readonly signed?: boolean } = {},
): {
  readonly exeName: string;
  readonly publicUrl: string;
} {
  mkdirSync(artifactsRoot, { recursive: true });
  const signed = options.signed !== false;
  const exeName = `xrk-harness-${version}-win-x64${signed ? "" : "-unsigned"}.exe`;
  const exeBody = Buffer.from("fake-nsis-payload");
  const sha = sha512Base64(exeBody);
  writeFileSync(join(artifactsRoot, exeName), exeBody);
  writeFileSync(
    join(artifactsRoot, `${exeName}.blockmap`),
    Buffer.from("fake-blockmap"),
  );
  writeFileSync(
    join(artifactsRoot, "nightly.yml"),
    [
      `version: ${version}`,
      "files:",
      `  - url: ${exeName}`,
      `    sha512: ${sha}`,
      `    size: ${exeBody.byteLength}`,
      `path: ${exeName}`,
      `sha512: ${sha}`,
      `size: ${exeBody.byteLength}`,
      "",
    ].join("\n"),
  );
  const publicUrl = "https://updates.example.test/desktop/win-x64";
  writeFileSync(
    join(artifactsRoot, desktopPackageCompleteFilename("win-x64")),
    JSON.stringify(
      {
        schemaVersion: 1,
        target: "win-x64",
        version,
        environment: "test",
        publicUrl,
        signed,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { exeName, publicUrl };
}

describe("desktop upload plan / run", () => {
  it("resolves upload destination for first-wave targets", () => {
    const config = resolveDesktopUploadConfig(testUploadEnv(), "win32", "x64");
    expect(config).toMatchObject({
      environment: "test",
      target: "win-x64",
      publicUrl: "https://updates.example.test/desktop/win-x64",
      keyPrefix: "desktop/win-x64",
      binaryKeyPrefix: "desktop/bin/win-x64",
      bucket: "xrk-desktop-test",
    });
  });

  it("parses electron-builder update metadata YAML", () => {
    const parsed = parseDesktopUpdateMetadataYaml(
      [
        "version: 1.2.3",
        "files:",
        "  - url: xrk-harness-1.2.3-win-x64.exe",
        "    sha512: abc=",
        "    size: 42",
        "",
      ].join("\n"),
    );
    expect(parsed.version).toBe("1.2.3");
    expect(parsed.files).toEqual([
      {
        filename: "xrk-harness-1.2.3-win-x64.exe",
        sha512: "abc=",
        size: 42,
      },
    ]);
  });

  it("validates win-x64 artifacts and mirrors via filesystem transport", async () => {
    const root = mkdtempSync(join(tmpdir(), "xrk-desktop-upload-"));
    tempDirs.push(root);
    const artifactsRoot = join(root, "artifacts");
    const version = "0.0.0";
    const { exeName, publicUrl } = seedWinX64Artifacts(artifactsRoot, version);

    const plan = await createDesktopUploadPlan("win-x64", {
      environment: testUploadEnv(),
      artifactsRoot,
    });
    expect(plan.version).toBe(version);
    expect(plan.publicUrl).toBe(publicUrl);
    expect(plan.artifacts.map((a) => a.filename)).toEqual([
      exeName,
      `${exeName}.blockmap`,
      "nightly.yml",
      "latest.yml",
    ]);
    const nightly = plan.artifacts.find((a) => a.filename === "nightly.yml");
    expect(nightly?.channelMetadata).toBe(true);
    expect(nightly?.contents).toContain(
      `url: https://updates.example.test/desktop/bin/win-x64/${exeName}`,
    );

    const mirrorRoot = join(root, "mirror");
    const recordsRoot = join(root, "records");
    const recordDir = await uploadDesktopRelease(
      plan,
      createDesktopFilesystemUploadTransport(mirrorRoot),
      recordsRoot,
    );
    expect(existsSync(join(mirrorRoot, "desktop", "bin", "win-x64", exeName))).toBe(
      true,
    );
    expect(
      existsSync(join(mirrorRoot, "desktop", "win-x64", "nightly.yml")),
    ).toBe(true);
    expect(
      existsSync(join(mirrorRoot, "desktop", "win-x64", "latest.yml")),
    ).toBe(true);
    const result = JSON.parse(
      readFileSync(join(recordDir, "result.json"), "utf8"),
    ) as { ok: boolean; confirmedPuts: number };
    expect(result.ok).toBe(true);
    expect(result.confirmedPuts).toBe(4);
  });

  it("validates unsigned win-x64 artifact names from package-complete", async () => {
    const root = mkdtempSync(join(tmpdir(), "xrk-desktop-upload-unsigned-"));
    tempDirs.push(root);
    const artifactsRoot = join(root, "unsigned-artifacts");
    const { exeName } = seedWinX64Artifacts(artifactsRoot, "0.0.0", {
      signed: false,
    });
    const plan = await createDesktopUploadPlan("win-x64", {
      environment: testUploadEnv(),
      artifactsRoot,
    });
    expect(plan.artifacts[0]?.filename).toBe(exeName);
    expect(exeName).toContain("-unsigned");
  });

  it("rejects completion records that do not match the update destination", async () => {
    const root = mkdtempSync(join(tmpdir(), "xrk-desktop-upload-bad-"));
    tempDirs.push(root);
    const artifactsRoot = join(root, "artifacts");
    seedWinX64Artifacts(artifactsRoot, "0.0.0");
    writeFileSync(
      join(artifactsRoot, desktopPackageCompleteFilename("win-x64")),
      JSON.stringify({
        schemaVersion: 1,
        target: "win-x64",
        version: "0.0.0",
        environment: "production",
        publicUrl: "https://wrong.example/desktop/win-x64",
      }),
    );
    await expect(
      createDesktopUploadPlan("win-x64", {
        environment: testUploadEnv(),
        artifactsRoot,
      }),
    ).rejects.toThrow(/does not match the test update destination/);
  });
});
