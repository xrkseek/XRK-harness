/**
 * Desktop-owned `xrkh` / `xrk-harness` shims under `{XRK_HOME}/bin`.
 * Prepended on the user PATH so they win over an older npm-global install.
 * Each app launch rewrites the shim to the current bundled node + cli.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CLI_COMMAND_PREF_FILE = "cli-command.json";
const SHIM_MARKER = "XRK_DESKTOP_CLI_SHIM";

export interface CliCommandLinkInput {
  readonly xrkHome: string;
  readonly nodePath: string;
  readonly cliBinPath: string;
  readonly platform: NodeJS.Platform;
  readonly enabled: boolean;
  readUserPath(): string;
  writeUserPath(next: string): void;
}

export interface CliCommandLinkResult {
  readonly linked: boolean;
  readonly binDir: string;
}

export function cliCommandBinDir(xrkHome: string): string {
  return path.join(xrkHome, "bin");
}

export function cliCommandPrefPath(xrkHome: string): string {
  return path.join(xrkHome, CLI_COMMAND_PREF_FILE);
}

/** Missing or unreadable pref means link (product default). */
export function readCliCommandEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return true;
  try {
    const doc = JSON.parse(raw) as { link?: unknown };
    return doc.link !== false;
  } catch {
    return true;
  }
}

export function writeCliCommandEnabled(enabled: boolean): string {
  return `${JSON.stringify({ link: enabled }, null, 2)}\n`;
}

function pathSep(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function sameDir(a: string, b: string, platform: NodeJS.Platform): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Put `dir` first. Drops duplicate entries of that directory. */
export function prependPathEntry(
  existing: string,
  dir: string,
  platform: NodeJS.Platform,
): string {
  const sep = pathSep(platform);
  const parts = existing.split(sep).filter((part) => part.trim() !== "");
  const rest = parts.filter((part) => !sameDir(part, dir, platform));
  return [dir, ...rest].join(sep);
}

const POSIX_BEGIN = "# >>> XRK_DESKTOP_CLI_SHIM >>>";
const POSIX_END = "# <<< XRK_DESKTOP_CLI_SHIM <<<";

/** Insert or remove the marked PATH block in a shell profile. */
export function mergePosixProfile(
  existing: string,
  binDir: string,
  enabled: boolean,
): string {
  const pattern =
    /# >>> XRK_DESKTOP_CLI_SHIM >>>[\s\S]*?# <<< XRK_DESKTOP_CLI_SHIM <<<\n?/;
  const stripped = existing.replace(pattern, "");
  if (!enabled) return stripped.replace(/\n{3,}/g, "\n\n");
  const block = `${POSIX_BEGIN}\nexport PATH="${binDir}:$PATH"\n${POSIX_END}\n`;
  const base = stripped.endsWith("\n") || stripped.length === 0
    ? stripped
    : `${stripped}\n`;
  return `${base}${block}`;
}

export function removePathEntry(
  existing: string,
  dir: string,
  platform: NodeJS.Platform,
): string {
  const sep = pathSep(platform);
  return existing
    .split(sep)
    .filter((part) => part.trim() !== "" && !sameDir(part, dir, platform))
    .join(sep);
}

function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** POSIX single quotes — `$` and spaces in the bundled node path stay literal. */
function quoteSh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Profiles sourced by interactive login and non-login shells (macOS Terminal, zsh, bash). */
export const POSIX_CLI_PROFILES = [
  ".zprofile",
  ".zshrc",
  ".bashrc",
  ".profile",
] as const;

function shims(
  platform: NodeJS.Platform,
  nodePath: string,
  cliBinPath: string,
): ReadonlyArray<{ name: string; body: string; mode?: number }> {
  if (platform === "win32") {
    // `.cmd` only. A sibling `.ps1` is what PowerShell runs first, and the
    // default execution policy blocks it — `xrkh` then looks broken.
    const cmd = `@echo off\r\nREM ${SHIM_MARKER}\r\n${quoteCmd(nodePath)} ${quoteCmd(cliBinPath)} %*\r\n`;
    return [
      { name: "xrkh.cmd", body: cmd },
      { name: "xrk-harness.cmd", body: cmd },
    ];
  }
  const body = `#!/bin/sh\n# ${SHIM_MARKER}\nexec ${quoteSh(nodePath)} ${quoteSh(cliBinPath)} "$@"\n`;
  return [
    { name: "xrkh", body, mode: 0o755 },
    { name: "xrk-harness", body, mode: 0o755 },
  ];
}

function removeOwnedShims(binDir: string, platform: NodeJS.Platform): void {
  const names = [
    ...shims(platform, "node", "bin").map((entry) => entry.name),
    // Older desktop builds wrote these; drop them so PowerShell stops preferring them.
    "xrkh.ps1",
    "xrk-harness.ps1",
  ];
  for (const name of names) {
    const file = path.join(binDir, name);
    try {
      const text = readFileSync(file, "utf8");
      if (!text.includes(SHIM_MARKER)) continue;
      rmSync(file, { force: true });
    } catch {
      /* absent */
    }
  }
}

/**
 * Rewrite shims to the current bundle and prepend `{XRK_HOME}/bin`.
 * When disabled, remove only shims this installer wrote and drop that PATH entry.
 */
export function applyCliCommandLink(
  input: CliCommandLinkInput,
): CliCommandLinkResult {
  const binDir = cliCommandBinDir(input.xrkHome);
  const current = input.readUserPath();
  if (!input.enabled) {
    removeOwnedShims(binDir, input.platform);
    const next = removePathEntry(current, binDir, input.platform);
    if (next !== current) input.writeUserPath(next);
    return { linked: false, binDir };
  }
  mkdirSync(binDir, { recursive: true });
  for (const entry of shims(input.platform, input.nodePath, input.cliBinPath)) {
    writeFileSync(path.join(binDir, entry.name), entry.body, {
      encoding: "utf8",
      ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
    });
  }
  const next = prependPathEntry(current, binDir, input.platform);
  if (next !== current) input.writeUserPath(next);
  return { linked: true, binDir };
}
