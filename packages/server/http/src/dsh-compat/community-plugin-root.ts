/**
 * Resolve staged community plugin package roots under pluginsDir.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** Candidate install dirs for one npm package id (scoped or bare). */
export function communityPluginCandidates(
  pluginsDir: string,
  packageName: string,
): string[] {
  const name = packageName.trim();
  if (!name) return [];
  const parts = name.split("/");
  return [
    path.join(pluginsDir, "web", "plugins", ...parts),
    path.join(pluginsDir, ...parts),
    path.join(pluginsDir, "web", "plugins", parts[parts.length - 1]!),
    path.join(pluginsDir, parts[parts.length - 1]!),
  ];
}

/** First existing package root that has package.json. */
export function findCommunityPluginRoot(
  pluginsDir: string | undefined,
  packageNames: readonly string[],
): string | undefined {
  if (!pluginsDir?.trim()) return undefined;
  for (const name of packageNames) {
    for (const candidate of communityPluginCandidates(pluginsDir, name)) {
      if (existsSync(path.join(candidate, "package.json"))) return candidate;
    }
  }
  return undefined;
}
