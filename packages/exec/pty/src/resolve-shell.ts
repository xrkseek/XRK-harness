/**
 * Resolve the interactive shell used by agent / sidebar PTYs.
 * Windows → pwsh (DSH / Codex); POSIX → bash.
 */

import { lstatSync } from "node:fs";
import { join } from "node:path";

function candidatePwshPaths(env: NodeJS.ProcessEnv = process.env): string[] {
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

function exists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolvePtyShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { readonly shellPath: string; readonly shellArgs: readonly string[] } {
  if (platform === "win32") {
    let shellPath = "pwsh";
    for (const candidate of candidatePwshPaths(env)) {
      if (exists(candidate)) {
        shellPath = candidate;
        break;
      }
    }
    return { shellPath, shellArgs: ["-NoLogo", "-NoProfile"] };
  }
  return {
    shellPath: "/bin/bash",
    shellArgs: ["--noprofile", "--norc", "-i"],
  };
}
