#!/usr/bin/env node
/**
 * First-wave Desktop installer gate (ADR-0008).
 * Does not produce NSIS/dmg and does not become the product entry.
 * Current phase is development-projection (`pnpm dev:desktop`).
 */
const platform = process.platform;
const arch = process.arch;
const target =
  platform === "win32" && arch === "x64"
    ? "win-x64"
    : platform === "darwin" && arch === "arm64"
      ? "mac-arm64"
      : null;

if (target === null) {
  process.stderr.write(
    `package-desktop: host ${platform}/${arch} is not a first-wave packaging host (win-x64, mac-arm64)\n`,
  );
  process.exit(2);
}

process.stderr.write(
  "package-desktop: refusing to skip ADR-0008.\n" +
    "  Default product entry remains `xrkh web` / CLI.\n" +
    "  Current Desktop phase is development-projection (`pnpm dev:desktop`).\n" +
    `  First-wave installer for ${target} is not produced here.\n`,
);
process.exit(2);
