#!/usr/bin/env node
/**
 * First-wave Desktop packaging (ADR-0008).
 *
 *   pnpm package:desktop              # validate pipeline + write package-plan.json
 *   pnpm package:desktop -- --check   # same validate
 *   XRK_DESKTOP_PACKAGE=1 pnpm package:desktop [-- --dir]
 *
 * Default product entry remains `xrkh web` / CLI.
 * Unsigned Windows: XRK_DESKTOP_UNSIGNED=1
 * Signing: XRK_DESKTOP_WINDOWS_* / XRK_DESKTOP_MACOS_*
 * Auto-update feed origin: XRK_DESKTOP_UPDATE_*_ORIGIN (app-update.yml; upload phase 2)
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createElectronBuilderConfig } from "../apps/desktop/scripts/electron-builder-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = path.join(ROOT, "apps", "desktop");
const DIST_ENTRY = path.join(APP_ROOT, "dist", "package-targets.js");

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    check: { type: "boolean", default: false },
    dir: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help) {
  process.stdout.write(
    "package-desktop: first-wave win-x64 | mac-arm64\n" +
      "  --check                 validate pipeline (default)\n" +
      "  --dir                   electron-builder directory output\n" +
      "  XRK_DESKTOP_PACKAGE=1   run electron-builder\n" +
      "  XRK_DESKTOP_UNSIGNED=1  unsigned Windows NSIS\n",
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
      "package-desktop: build @xrkseek/harness-desktop first\n" +
        "  pnpm --filter @xrkseek/harness-desktop build\n",
    );
    if (viaPnpm.stderr) process.stderr.write(viaPnpm.stderr);
    process.exit(1);
  }
}

ensureDesktopDist();
const requireFromDesktop = createRequire(path.join(APP_ROOT, "package.json"));
const {
  assertDesktopPackageHostCompatible,
  desktopElectronBuilderArguments,
  resolveDesktopPackageTarget,
} = requireFromDesktop("./dist/package-targets.js");
const buildPaths = requireFromDesktop("./dist/build-paths.js");
const productEntry = requireFromDesktop("./dist/product-entry.js");

const produce = process.env.XRK_DESKTOP_PACKAGE === "1";
const checkOnly = values.check || !produce;

let target;
try {
  const explicit =
    positionals[0]?.trim() || process.env.XRK_DESKTOP_TARGET?.trim();
  if (explicit) {
    target = resolveDesktopPackageTarget(explicit);
  } else {
    try {
      target = resolveDesktopPackageTarget(
        buildPaths.resolveDesktopBuildTarget(
          process.env,
          process.platform,
          process.arch,
        ),
      );
    } catch (hostError) {
      // Linux CI / deferred hosts: --check still validates first-wave plan shape.
      if (!checkOnly) throw hostError;
      target = resolveDesktopPackageTarget("win-x64");
    }
  }
  // Host OS gate only when actually producing an installer.
  if (!checkOnly) {
    assertDesktopPackageHostCompatible(target, process.platform, process.arch);
  }
} catch (error) {
  process.stderr.write(
    `package-desktop: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

const entry = productEntry.assertDesktopInstallerNotDefaultEntry();
const paths = buildPaths.desktopTargetBuildPaths(target.name, APP_ROOT);
mkdirSync(paths.artifacts, { recursive: true });
mkdirSync(paths.unsignedArtifacts, { recursive: true });

const builderConfig = createElectronBuilderConfig(
  { ...process.env, XRK_DESKTOP_TARGET: target.name },
  process.platform,
  process.arch,
);
const planPath = path.join(paths.root, "package-plan.json");
const builderArgs = desktopElectronBuilderArguments(target, {
  directory: values.dir,
});
writeFileSync(
  planPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      target: target.name,
      phase: entry.phase,
      packagingPipelineReady: entry.packagingPipelineReady,
      installerShipped: entry.installerShipped,
      defaultEntry: entry.defaultEntry,
      unsigned: process.env.XRK_DESKTOP_UNSIGNED === "1",
      directories: builderConfig.directories,
      publish: builderConfig.publish,
      builderArgs,
    },
    null,
    2,
  ),
  "utf8",
);

if (checkOnly) {
  process.stdout.write(
    `package-desktop: first-wave pipeline ready for ${target.name}\n` +
      `  phase=${entry.phase} packagingPipelineReady=${entry.packagingPipelineReady}\n` +
      `  defaultEntry=${entry.defaultEntry} (installer is not the day-1 entry)\n` +
      `  plan=${path.relative(ROOT, planPath)}\n` +
      `  to produce artifacts: XRK_DESKTOP_PACKAGE=1 pnpm package:desktop` +
      (values.dir ? " -- --dir" : "") +
      `\n` +
      `  unsigned Windows: XRK_DESKTOP_UNSIGNED=1\n` +
      `  optional deps: electron · electron-builder · electron-updater\n`,
  );
  process.exit(0);
}

try {
  requireFromDesktop.resolve("electron-builder/package.json");
} catch {
  process.stderr.write(
    "package-desktop: electron-builder is not installed under @xrkseek/harness-desktop\n" +
      "  Install: pnpm --filter @xrkseek/harness-desktop add -D electron electron-builder electron-updater\n" +
      "  Pipeline check already passed; refusing to fake an installer.\n",
  );
  process.exit(1);
}

const required = [
  path.join(APP_ROOT, "dist", "main.js"),
  path.join(ROOT, "apps", "desktop-host", "dist", "index.js"),
  path.join(ROOT, "apps", "web", "dist", "index.html"),
];
for (const file of required) {
  if (!existsSync(file)) {
    process.stderr.write(
      `package-desktop: missing ${path.relative(ROOT, file)} (run pnpm build:desktop)\n`,
    );
    process.exit(1);
  }
}

process.stdout.write(
  `package-desktop: running pnpm ${builderArgs.join(" ")} (cwd=apps/desktop)\n`,
);
const result = spawnSync("pnpm", builderArgs, {
  cwd: APP_ROOT,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    XRK_DESKTOP_TARGET: target.name,
  },
});
process.exit(result.status ?? 1);
