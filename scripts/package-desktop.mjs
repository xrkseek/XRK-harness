#!/usr/bin/env node
/**
 * First-wave Desktop packaging (ADR-0008).
 *
 *   pnpm package:desktop              # validate pipeline + write package-plan.json
 *   pnpm package:desktop -- --check   # same validate
 *   XRK_DESKTOP_PACKAGE=1 pnpm package:desktop [-- --dir]
 *
 * Default product entry remains `xrkh web` / CLI.
 * Signing: copy apps/desktop/.env.windows.example → .env.windows (or .env.macos)
 *           and fill XRK_DESKTOP_WINDOWS_* / XRK_DESKTOP_MACOS_*
 * Unsigned Windows: XRK_DESKTOP_UNSIGNED=1
 * Auto-update feed origin: XRK_DESKTOP_UPDATE_*_ORIGIN (app-update.yml)
 * After produce: writes package-complete-*.json; upload via `pnpm upload:desktop`
 * Produce always runs `pnpm build:desktop` first (host + client:bundle + web:assemble).
 * There is no skip-shell-build escape hatch — stale Web was the usual packaging bug.
 * On Windows, if NSIS fails with "Can't open output file" under a non-ASCII path,
 * run from an ASCII junction (e.g. mklink /J C:\xrk-h <repo>).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    "package-desktop: win-x64 | mac-arm64 | mac-x64\n" +
      "  --check                 validate pipeline (default)\n" +
      "  --dir                   electron-builder directory output\n" +
      "  XRK_DESKTOP_PACKAGE=1   run electron-builder\n" +
      "  XRK_DESKTOP_UNSIGNED=1  unsigned Windows NSIS\n" +
      "  signing env file:       apps/desktop/.env.windows | .env.macos\n",
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
  desktopElectronBuilderEnvironment,
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
      // Linux CI / deferred hosts: --check still validates release-plan shape.
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

const packageEnvMod = requireFromDesktop(
  "./dist/desktop-package-environment.js",
);
/** @type {NodeJS.ProcessEnv} */
let packageEnvironment = { ...process.env };
try {
  const loaded = packageEnvMod.tryLoadDesktopPackageEnvironment(
    target.platform === "darwin" ? "darwin" : "win32",
    process.env,
    APP_ROOT,
  );
  if (loaded !== undefined) {
    packageEnvironment = loaded;
    packageEnvMod.assertDesktopPackageSigningFiles(packageEnvironment);
  }
} catch (error) {
  process.stderr.write(
    `package-desktop: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

const signing = requireFromDesktop("./dist/desktop-signing-environment.js");
let signingPlan;
try {
  signingPlan = signing.describeDesktopSigningPlan(
    { ...packageEnvironment, XRK_DESKTOP_TARGET: target.name },
    process.platform,
  );
} catch (error) {
  process.stderr.write(
    `package-desktop: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

// Produce requires an explicit signing posture (unsigned OR full token/identity).
// mode=none would drop a release-named installer into artifacts/ without Authenticode.
if (
  produce &&
  signingPlan.mode === "none" &&
  (target.name.startsWith("win-") || target.name.startsWith("mac-"))
) {
  process.stderr.write(
    `package-desktop: refusing to produce ${target.name} with signing mode=none\n` +
      `  Windows: set XRK_DESKTOP_UNSIGNED=1, or fill CER_FILE + SIGNTOOL + TOKEN_PIN + KEY_CONTAINER\n` +
      `  macOS: set XRK_DESKTOP_MACOS_IDENTITY (+ Apple-id trio for notarize)\n` +
      `  env file: apps/desktop/.env.${target.platform === "darwin" ? "macos" : "windows"}\n`,
  );
  process.exit(2);
}

const builderConfig = createElectronBuilderConfig(
  { ...packageEnvironment, XRK_DESKTOP_TARGET: target.name },
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
      unsigned: packageEnvironment.XRK_DESKTOP_UNSIGNED === "1",
      signing: signingPlan,
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
    `package-desktop: packaging pipeline ready for ${target.name}\n` +
      `  phase=${entry.phase} packagingPipelineReady=${entry.packagingPipelineReady}\n` +
      `  defaultEntry=${entry.defaultEntry} (installer is not the day-1 entry)\n` +
      `  plan=${path.relative(ROOT, planPath)}\n` +
      `  to produce artifacts: XRK_DESKTOP_PACKAGE=1 pnpm package:desktop` +
      (values.dir ? " -- --dir" : "") +
      `\n` +
      `  unsigned Windows: XRK_DESKTOP_UNSIGNED=1\n` +
      `  Windows token sign: XRK_DESKTOP_WINDOWS_CER_FILE + SIGNTOOL + TOKEN_PIN + KEY_CONTAINER\n` +
      `  macOS: XRK_DESKTOP_MACOS_IDENTITY (+ APPLE_ID / PASSWORD / TEAM_ID for notarize)\n` +
      `  signing mode: ${signingPlan.mode}` +
      (signingPlan.notarize ? " (notarize)" : "") +
      `\n` +
      `  env file: apps/desktop/.env.${target.platform === "darwin" ? "macos" : "windows"}` +
      (existsSync(
        path.join(
          APP_ROOT,
          target.platform === "darwin" ? ".env.macos" : ".env.windows",
        ),
      )
        ? " (loaded)"
        : " (missing — copy *.example)") +
      `\n` +
      `  installerShipped=${entry.installerShipped} (default entry remains ${entry.defaultEntry})\n` +
      `  upload: pnpm upload:desktop -- --check ${target.name}\n` +
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
  path.join(APP_ROOT, "dist", "preload-app.cjs"),
  path.join(ROOT, "apps", "desktop-host", "dist", "index.js"),
  path.join(ROOT, "apps", "web", "dist", "index.html"),
];

/**
 * Always refresh Desktop + product Web before electron-builder.
 * Stale `apps/web/dist` (client CSS/JS) otherwise ships yesterday's shell.
 */
function ensureFreshProductShell() {
  process.stdout.write("package-desktop: build:desktop (host + client + web)…\n");
  const build = spawnSync("pnpm", ["run", "build:desktop"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);
}

if (produce) {
  ensureFreshProductShell();
}

for (const file of required) {
  if (!existsSync(file)) {
    process.stderr.write(
      `package-desktop: missing ${path.relative(ROOT, file)} (run pnpm build:desktop)\n`,
    );
    process.exit(1);
  }
}

function ensureProduceArtifacts() {
  const runtimeNode = path.join(
    paths.runtime,
    "node",
    process.platform === "win32" ? "node.exe" : "node",
  );
  if (!existsSync(runtimeNode)) {
    process.stdout.write("package-desktop: prepare:runtime…\n");
    const prep = spawnSync(
      "pnpm",
      ["--filter", "@xrkseek/harness-desktop", "prepare:runtime", "--", target.name],
      { cwd: ROOT, stdio: "inherit", shell: true },
    );
    if ((prep.status ?? 1) !== 0) process.exit(prep.status ?? 1);
  }
  // Always refresh host-bundle so workspace Face/pipe fixes are not skipped by a
  // stale deploy tree from an earlier package run.
  process.stdout.write("package-desktop: prepare-host-bundle…\n");
  const prepHost = spawnSync(
    process.execPath,
    [
      path.join(APP_ROOT, "scripts", "prepare-host-bundle.mjs"),
      target.name,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if ((prepHost.status ?? 1) !== 0) process.exit(prepHost.status ?? 1);

  process.stdout.write("package-desktop: smoke packaged Host loopback Face…\n");
  const smokeHome = path.join(paths.root, "smoke-host-home");
  const nodeExe = path.join(
    paths.runtime,
    "node",
    process.platform === "win32" ? "node.exe" : "node",
  );
  const smoke = spawnSync(
    process.execPath,
    [
      path.join(APP_ROOT, "scripts", "smoke-packaged-host.mjs"),
      path.join(paths.root, "host-bundle"),
      smokeHome,
      nodeExe,
      path.join(ROOT, "apps", "web", "dist"),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if ((smoke.status ?? 1) !== 0) process.exit(smoke.status ?? 1);
}

ensureProduceArtifacts();

process.stdout.write(
  `package-desktop: running pnpm ${builderArgs.join(" ")} (cwd=apps/desktop)\n`,
);
const unsigned = packageEnvironment.XRK_DESKTOP_UNSIGNED === "1";
const result = spawnSync("pnpm", builderArgs, {
  cwd: APP_ROOT,
  stdio: "inherit",
  shell: true,
  env: desktopElectronBuilderEnvironment(
    {
      ...packageEnvironment,
      XRK_DESKTOP_TARGET: target.name,
    },
    unsigned,
  ),
});
if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// electron-builder / pnpm filter may prune the workspace root; restore so
// subsequent test/dev commands keep vitest and other root tools.
process.stdout.write("package-desktop: restore workspace node_modules…\n");
const restore = spawnSync("pnpm", ["install", "--prod=false"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, CI: "true", NODE_ENV: "development" },
});
if ((restore.status ?? 1) !== 0) {
  process.stderr.write(
    "package-desktop: warning: pnpm install restore failed; run pnpm install manually\n",
  );
}

const autoUpdate = requireFromDesktop("./dist/desktop-auto-update-environment.js");
const platform = target.name.startsWith("mac-") ? "darwin" : "win32";
const arch = target.name.endsWith("arm64") ? "arm64" : "x64";
let update;
try {
  update =
    unsigned && !autoUpdate.isDesktopUnsignedUpdateRequested(packageEnvironment)
      ? undefined
      : autoUpdate.resolveDesktopAutoUpdateConfig(
          packageEnvironment,
          platform,
          arch,
        );
} catch {
  update = undefined;
}
const desktopPkg = JSON.parse(
  readFileSync(path.join(APP_ROOT, "package.json"), "utf8"),
);
const version =
  typeof desktopPkg.version === "string" && desktopPkg.version.length > 0
    ? desktopPkg.version
    : "0.0.0";
const artifactsDir = unsigned ? paths.unsignedArtifacts : paths.artifacts;
if (update !== undefined) {
  const completeName = autoUpdate.desktopPackageCompleteFilename(target.name);
  writeFileSync(
    path.join(artifactsDir, completeName),
    JSON.stringify(
      {
        schemaVersion: 1,
        target: target.name,
        version,
        environment: update.channel,
        publicUrl: update.publicUrl,
        signed: !unsigned,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  process.stdout.write(
    `package-desktop: wrote ${path.relative(ROOT, path.join(artifactsDir, completeName))}\n` +
      `  next: pnpm upload:desktop -- --check ${target.name}\n`,
  );
} else {
  process.stdout.write(
    unsigned
      ? `package-desktop: unsigned build — no update feed / package-complete (set XRK_DESKTOP_UNSIGNED_UPDATE=1 to embed a test feed)\n`
      : `package-desktop: no update origin configured; skip package-complete ` +
          `(set XRK_DESKTOP_UPDATE_TEST_ORIGIN or XRK_DESKTOP_UPDATE_ORIGIN for upload)\n`,
  );
}
process.exit(0);
