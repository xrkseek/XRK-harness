/**
 * Product shell lives next to this CLI app (`apps/web-static`), not inside
 * the user's `--workspace`. Recapture under `vendor/` is gitignored.
 */
import { access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function cliPackageRoot(): string {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

export function harnessAppsRoot(): string {
  return path.resolve(cliPackageRoot(), "..");
}

export function readCliVersion(): string {
  try {
    const raw = readFileSync(
      path.join(cliPackageRoot(), "package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function defaultSessionsDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".xrk", "sessions");
}

export async function resolveProductWebDist(
  configured?: string,
): Promise<string | undefined> {
  if (configured?.trim()) return path.resolve(configured.trim());
  const apps = harnessAppsRoot();
  const repo = path.resolve(apps, "..");
  const candidates = [
    path.join(apps, "web-static"),
    path.join(repo, "vendor", "web-static"),
    path.join(apps, "web", "dist"),
  ];
  for (const dir of candidates) {
    try {
      await access(path.join(dir, "index.html"));
      return dir;
    } catch {
      /* try next */
    }
  }
  return undefined;
}
