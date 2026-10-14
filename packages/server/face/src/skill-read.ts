/**
 * skill.read — Face RPC: full SKILL.md body or inject document text.
 */

import path from "node:path";
import { loadSkill } from "@xrkseek/workspace";
import type { FaceRpcResult } from "./types.js";
import { classifySkillSource } from "./skill-source.js";
import { readInjectDocument } from "./skill-documents.js";

const MAX_SKILL_CHARS = 200_000;

/** skill.read response value. */
export type SkillReadValue =
  | {
      readonly kind: "skill";
      readonly name: string;
      readonly description: string;
      readonly content: string;
      readonly source: ReturnType<typeof classifySkillSource>;
    }
  | {
      readonly kind: "document";
      readonly path: string;
      readonly content: string;
    };

/**
 * Read one skill (by name) or one inject document (by logical path).
 * Exactly one of `name` / `document` is required.
 */
export async function skillRead(
  workspaceRoot: string,
  payload: unknown,
): Promise<FaceRpcResult<SkillReadValue>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const row = payload as Record<string, unknown>;
  const sessionId = String(row.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const document = typeof row.document === "string" ? row.document.trim() : "";
  if ((name ? 1 : 0) + (document ? 1 : 0) !== 1) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "exactly one of name or document required",
      },
    };
  }

  const root = path.resolve(workspaceRoot);

  if (document) {
    const loaded = await readInjectDocument(root, document);
    if (!loaded) {
      return {
        ok: false,
        error: { code: "not-found", message: document },
      };
    }
    return {
      ok: true,
      value: { kind: "document", path: loaded.path, content: loaded.content },
    };
  }

  const skill = await loadSkill({ workspaceRoot: root, name });
  if (!skill) {
    return {
      ok: false,
      error: { code: "not-found", message: name },
    };
  }
  const content =
    skill.content.length > MAX_SKILL_CHARS
      ? `${skill.content.slice(0, MAX_SKILL_CHARS)}\n\n… [truncated]`
      : skill.content;
  return {
    ok: true,
    value: {
      kind: "skill",
      name: skill.name,
      description: skill.description,
      content,
      source: classifySkillSource(skill.directory, root),
    },
  };
}
