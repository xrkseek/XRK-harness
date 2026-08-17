/**
 * skill.list — scan workspace .xrk/skills/<id>/SKILL.md (AGT-style cards).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FaceRpcResult } from "./types.js";

export interface SkillEntry {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly modelInvocable: boolean;
}

function parseSkillMd(raw: string, fallbackName: string): SkillEntry {
  let body = raw;
  let name = fallbackName;
  let description = "";
  let whenToUse: string | undefined;

  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) {
      const fm = raw.slice(3, end).trim();
      body = raw.slice(end + 4).trim();
      for (const line of fm.split(/\r?\n/)) {
        const m = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1]!;
        const val = m[2]!.replace(/^["']|["']$/g, "").trim();
        if (key === "name" && val) name = val;
        if (key === "description" && val) description = val;
        if ((key === "whenToUse" || key === "when_to_use") && val) {
          whenToUse = val;
        }
      }
    }
  }

  if (!description) {
    const first = body
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0);
    description = first ?? name;
  }

  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    modelInvocable: true,
  };
}

export async function listSkillsFromWorkspace(
  workspaceRoot: string,
): Promise<readonly SkillEntry[]> {
  const root = path.resolve(workspaceRoot, ".xrk", "skills");
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: SkillEntry[] = [];
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = path.join(dir, "SKILL.md");
    try {
      const raw = await readFile(skillFile, "utf8");
      out.push(parseSkillMd(raw, name));
    } catch {
      out.push({
        name,
        description: name,
        modelInvocable: true,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function skillList(
  workspaceRoot: string,
  payload: unknown,
): Promise<FaceRpcResult<{ skills: readonly SkillEntry[] }>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const sessionId = String(
    (payload as Record<string, unknown>).sessionId ?? "",
  ).trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const skills = await listSkillsFromWorkspace(workspaceRoot);
  return { ok: true, value: { skills } };
}
