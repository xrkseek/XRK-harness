/**
 * skill.list — Face RPC over workspace skill roots
 * (`.xrk` / `.claude` / `.cursor` / `.agents` / `.codex` `/skills`, plus user home).
 * Also lists standing inject documents (AGENTS.md · …) and the session cwd label.
 * Missing roots are skipped; nothing is created.
 */

import path from "node:path";
import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";
import { listSkillsFromWorkspace, type SkillSummary } from "@xrkseek/workspace";
import {
  classifySkillSource,
  type SkillListSource,
} from "./skill-source.js";
import {
  listInjectDocuments,
  type InjectDocumentEntry,
} from "./skill-documents.js";
import { listSessionInjectDocuments } from "./session-inject-documents.js";
import { resolveSessionCwd } from "./session-cwd.js";

export type SkillEntry = Pick<
  SkillSummary,
  "name" | "description" | "whenToUse" | "modelInvocable" | "userInvocable"
> & {
  readonly source: SkillListSource;
};

/** Workspace label carried on catalog responses (no secrets). */
export interface SkillListWorkspace {
  /** Absolute session / Host cwd used for the scan. */
  readonly cwd: string;
  /** Basename of cwd for UI chrome. */
  readonly label: string;
}

/** skill.list response value. */
export interface SkillListValue {
  readonly skills: readonly SkillEntry[];
  readonly workspace: SkillListWorkspace;
  readonly documents: readonly InjectDocumentEntry[];
}

export { listSkillsFromWorkspace };
export type { SkillListSource, SkillListLayer, SkillListVendor } from "./skill-source.js";
export type { InjectDocumentEntry, InjectDocumentLayer } from "./skill-documents.js";

function toEntry(skill: SkillSummary, workspaceRoot: string): SkillEntry {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
    modelInvocable: skill.modelInvocable,
    userInvocable: skill.userInvocable,
    source: classifySkillSource(skill.directory, workspaceRoot),
  };
}

function workspaceLabel(cwd: string): SkillListWorkspace {
  const resolved = path.resolve(cwd);
  return {
    cwd: resolved,
    label: path.basename(resolved) || resolved,
  };
}

export async function skillList(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<SkillListValue>> {
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
  const root = path.resolve(resolveSessionCwd(runtime, sessionId));
  const [skills, standing] = await Promise.all([
    listSkillsFromWorkspace(root).then((rows) =>
      rows.map((s) => toEntry(s, root)),
    ),
    listInjectDocuments(root),
  ]);
  // Session turn-start fragments first so badge / permission are visible.
  const documents = [
    ...listSessionInjectDocuments(runtime, sessionId),
    ...standing,
  ];
  return {
    ok: true,
    value: {
      skills,
      workspace: workspaceLabel(root),
      documents,
    },
  };
}
