/**
 * skill.list — Face RPC over workspace `.xrk/skills/<id>/SKILL.md`.
 */

import type { FaceRpcResult } from "./types.js";
import { listSkillsFromWorkspace, type SkillSummary } from "@xrkseek/workspace";

export type SkillEntry = Pick<
  SkillSummary,
  "name" | "description" | "whenToUse" | "modelInvocable"
>;

export { listSkillsFromWorkspace };

function toEntry(skill: SkillSummary): SkillEntry {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
    modelInvocable: skill.modelInvocable,
  };
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
  const skills = (await listSkillsFromWorkspace(workspaceRoot)).map(toEntry);
  return { ok: true, value: { skills } };
}
