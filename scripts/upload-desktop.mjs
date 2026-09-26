#!/usr/bin/env node
/**
 * Desktop update-channel upload (ADR-0008).
 *
 *   pnpm upload:desktop -- --check win-x64     # validate plan only
 *   pnpm upload:desktop -- win-x64             # PUT via filesystem mirror (or inject transport later)
 *
 * Requires packaged artifacts + package-complete-*.json + nightly*.yml under artifacts/.
 * Credentials: XRK_DESKTOP_UPLOAD_* / XRK_DESKTOP_UPDATE_*_ORIGIN (scrubbed from package prep).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = path.join(ROOT, "apps", "desktop");
const DIST_ENTRY = path.join(APP_ROOT, "dist", "desktop-upload-plan.js");

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    check: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help) {
  process.stdout.write(
    "upload-desktop: update channel upload\n" +
      "  --check                 validate upload plan only\n" +
      "  <target>                win-x64 | mac-arm64 | mac-x64\n",
  );
  process.exit(0);
}

function ensureDesktopDist() {
  if (existsSync(DIST_ENTRY)) return;
  const viaPnpm = spawnSync(
    "pnpm",
    ["--filter", "@xrkseek/harness-desktop", "build"],
    { cwd: ROOT, encoding: "utf8", shell: true },
  );
  if (viaPnpm.status !== 0 || !existsSync(DIST_ENTRY)) {
    process.stderr.write(
      "upload-desktop: build @xrkseek/harness-desktop first\n",
    );
    process.exit(1);
  }
}

ensureDesktopDist();
const requireFromDesktop = createRequire(path.join(APP_ROOT, "package.json"));
const {
  resolveDesktopPackageTarget,
} = requireFromDesktop("./dist/package-targets.js");
const buildPaths = requireFromDesktop("./dist/build-paths.js");
const productEntry = requireFromDesktop("./dist/product-entry.js");
const {
  createDesktopUploadPlan,
} = requireFromDesktop("./dist/desktop-upload-plan.js");
const {
  createDesktopFilesystemUploadTransport,
  uploadDesktopRelease,
} = requireFromDesktop("./dist/desktop-upload-run.js");

const targetArg = positionals[0]?.trim();
if (!targetArg) {
  process.stderr.write(
    "upload-desktop: expected target win-x64 | mac-arm64 | mac-x64\n",
  );
  process.exit(2);
}

let target;
try {
  target = resolveDesktopPackageTarget(targetArg);
  productEntry.assertDesktopInstallerNotDefaultEntry();
} catch (error) {
  process.stderr.write(
    `upload-desktop: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

const paths = buildPaths.desktopTargetBuildPaths(target.name, APP_ROOT);
const completeName = `package-complete-${target.name}.json`;
const preferUnsigned =
  process.env.XRK_DESKTOP_UNSIGNED === "1" ||
  (!existsSync(path.join(paths.artifacts, completeName)) &&
    existsSync(path.join(paths.unsignedArtifacts, completeName)));
const artifactsRoot = preferUnsigned
  ? paths.unsignedArtifacts
  : paths.artifacts;

async function main() {
  let plan;
  try {
    plan = await createDesktopUploadPlan(target.name, {
      environment: process.env,
      artifactsRoot,
    });
  } catch (error) {
    process.stderr.write(
      `upload-desktop: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  const planOut = path.join(paths.root, "upload-plan.json");
  writeFileSync(
    planOut,
    JSON.stringify(
      {
        schemaVersion: 1,
        environment: plan.environment,
        target: plan.target,
        version: plan.version,
        publicUrl: plan.publicUrl,
        bucket: plan.bucket,
        artifactCount: plan.artifacts.length,
        artifacts: plan.artifacts.map((a) => ({
          key: a.key,
          filename: a.filename,
          channelMetadata: a.channelMetadata,
          contentType: a.contentType,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  if (values.check) {
    process.stdout.write(
      `upload-desktop: plan ok for ${plan.target} ${plan.version}\n` +
        `  publicUrl=${plan.publicUrl}\n` +
        `  artifacts=${plan.artifacts.length}\n` +
        `  plan=${path.relative(ROOT, planOut)}\n` +
        `  installerShipped=true (default entry remains cli-web)\n`,
    );
    process.exit(0);
  }

  const recordsRoot = path.join(APP_ROOT, ".desktop-build", "upload-records");
  const mirrorRoot = path.join(
    APP_ROOT,
    ".desktop-build",
    "upload-mirror",
    plan.environment,
  );
  mkdirSync(mirrorRoot, { recursive: true });
  try {
    const recordDir = await uploadDesktopRelease(
      plan,
      createDesktopFilesystemUploadTransport(mirrorRoot),
      recordsRoot,
    );
    process.stdout.write(
      `upload-desktop: uploaded ${plan.target} ${plan.version} -> ${plan.publicUrl}\n` +
        `  mirror=${path.relative(ROOT, mirrorRoot)}\n` +
        `  record=${path.relative(ROOT, recordDir)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `upload-desktop: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

main();
