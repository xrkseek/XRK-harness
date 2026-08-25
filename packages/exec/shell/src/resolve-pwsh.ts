/**
 * Resolve pwsh / Windows PowerShell for spawn (ported from DSH pwsh-local).
 */

import { lstatSync } from "node:fs";
import { join } from "node:path";

export function candidatePwshPaths(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  const candidates = [join(programFiles, "PowerShell", "7", "pwsh.exe")];
  for (const entry of (env.PATH ?? "").split(";")) {
    const trimmed = entry.trim().replace(/^"|"$/g, "");
    if (trimmed.length === 0) continue;
    candidates.push(join(trimmed, "pwsh.exe"));
  }
  candidates.push(
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  );
  return candidates;
}

function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolvePwshPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured;
  if (platform === "win32") {
    for (const candidate of candidatePwshPaths(env)) {
      if (candidateExists(candidate)) return candidate;
    }
  }
  return "pwsh";
}

/** Pin console / $OutputEncoding to UTF-8 (needed for Windows PowerShell 5.1). */
export const PWSH_ENCODING_PREAMBLE =
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";
