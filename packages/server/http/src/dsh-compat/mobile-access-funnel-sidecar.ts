/**
 * Resolve Tailscale Funnel sidecar binary (dsh-mobile bundle or env override).
 */
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { dataPath } from "./underlying/json-store.js";

const execFileAsync = promisify(execFile);

function funnelFilename(): string {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return `dsh-mobile-funnel-${process.platform}-${process.arch}${suffix}`;
}

function resolveNpmInvocation(): { command: string; prefixArgs: string[] } {
  const node = process.execPath;
  const npmCli = path.join(
    path.dirname(node),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (existsSync(npmCli)) {
    return { command: node, prefixArgs: [npmCli] };
  }
  const npmCmd =
    process.platform === "win32"
      ? path.join(path.dirname(node), "npm.cmd")
      : "npm";
  return { command: npmCmd, prefixArgs: [] };
}

function resolveTarCommand(): string {
  if (process.platform !== "win32") return "tar";
  const sysroot = process.env.SystemRoot ?? "C:\\Windows";
  const tarExe = path.join(sysroot, "System32", "tar.exe");
  return existsSync(tarExe) ? tarExe : "tar";
}

export function resolveFunnelOverride(): string | undefined {
  const override =
    process.env.XRK_MOBILE_FUNNEL_SIDECAR?.trim() ||
    process.env.DSH_MOBILE_FUNNEL_SIDECAR?.trim();
  if (!override) return undefined;
  if (!path.isAbsolute(override)) {
    throw new Error("XRK_MOBILE_FUNNEL_SIDECAR must be an absolute path");
  }
  return override;
}

export function resolveFunnelSidecarPath(
  xrkHome: string | undefined,
): string | undefined {
  const override = resolveFunnelOverride();
  if (override) return override;
  const dest = dataPath(
    xrkHome,
    "mobile-access",
    "components",
    "funnel",
    funnelFilename(),
  );
  return existsSync(dest) ? dest : undefined;
}

export async function ensureFunnelSidecar(
  xrkHome: string | undefined,
): Promise<string> {
  const existing = resolveFunnelSidecarPath(xrkHome);
  if (existing) return existing;

  const name = funnelFilename();
  const dest = dataPath(xrkHome, "mobile-access", "components", "funnel", name);
  await mkdir(path.dirname(dest), { recursive: true });

  const staging = dataPath(xrkHome, "mobile-access", "staging", "funnel-fetch");
  await mkdir(staging, { recursive: true });
  const packPath = path.join(staging, "dsh-mobile.tgz");
  const { command, prefixArgs } = resolveNpmInvocation();
  await execFileAsync(
    command,
    [
      ...prefixArgs,
      "pack",
      "dsh-mobile@0.2.0",
      "--silent",
      "--pack-destination",
      staging,
    ],
    { windowsHide: true, timeout: 180_000 },
  );
  const packed = existsSync(packPath)
    ? packPath
    : path.join(staging, "dsh-mobile-0.2.0.tgz");
  if (!existsSync(packed)) {
    throw new Error("funnel_sidecar_fetch_failed");
  }
  await execFileAsync(resolveTarCommand(), ["-xf", packed, "-C", staging], {
    windowsHide: true,
    timeout: 60_000,
  });
  const src = path.join(staging, "package", "bin", name);
  if (!existsSync(src)) {
    throw new Error("funnel_sidecar_missing_in_package");
  }
  await copyFile(src, dest);
  return dest;
}
