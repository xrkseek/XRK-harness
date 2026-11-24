/**
 * Meta-tool: search standing skills (Codex skill_search / omit_descriptions).
 * Standing inject lists names only; this returns blurbs; `skill` loads bodies.
 */

import {
  isBrowseCatalogQuery,
  type ToolDefinition,
} from "@xrkseek/core-tools";
import { scoreSkillAgainstQuery } from "./skill-select.js";
import {
  listSkills,
  type SkillSourceOptions,
  type SkillSummary,
} from "./skills.js";

export const SKILL_SEARCH_NAME = "skill_search";
/** Mirror tool_search default expand limit. */
export const SKILL_SEARCH_DEFAULT_LIMIT = 8;
/** Browse/list response budget (keep tool results short). */
const SKILL_SEARCH_LIST_MAX_CHARS = 3 * 1024;
const BLURB_MAX = 160;

export function skillSearchDescription(limitDefault: number): string {
  return (
    "Fuzzy-search skills; return up to " +
    `${limitDefault} name+blurb matches. ` +
    "Standing catalog is names-only — use this when unsure which skill fits. " +
    "`list`/`*`/empty → browse names; keyword (partial OK) → ranked blurbs. " +
    "Then `skill` loads the body by exact name."
  );
}

function formatNameList(skills: readonly SkillSummary[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const s of skills) {
    const line = `- \`${s.name}\``;
    if (used + line.length + 1 > maxChars && lines.length > 0) {
      lines.push(`… +${skills.length - lines.length} more (skill_search keyword)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function formatBlurbHits(skills: readonly SkillSummary[]): string {
  return skills
    .map((s) => {
      const blurb = s.description.replace(/\s+/g, " ").trim().slice(0, BLURB_MAX);
      return `- \`${s.name}\`: ${blurb}`;
    })
    .join("\n");
}

export function searchSkillsByQuery(
  skills: readonly SkillSummary[],
  query: string,
  limit: number,
): SkillSummary[] {
  const listed = skills.filter((s) => s.modelInvocable);
  const scored = listed
    .map((s) => ({ skill: s, score: scoreSkillAgainstQuery(s, query) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.skill.name.localeCompare(b.skill.name),
    );
  return scored.slice(0, limit).map((x) => x.skill);
}

export function createSkillSearchTool(
  options: SkillSourceOptions,
): ToolDefinition<{ query?: string; limit?: number }> {
  const limitDefault = SKILL_SEARCH_DEFAULT_LIMIT;
  return {
    name: SKILL_SEARCH_NAME,
    exposure: "direct",
    description: skillSearchDescription(limitDefault),
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Fuzzy keywords (partial OK), or `list`/`*`/empty to browse names.",
        },
        limit: {
          type: "integer",
          description: `Max matches with blurbs (default ${limitDefault}, max ${limitDefault}).`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args) {
      const all = await listSkills(options);
      const listed = [...all.filter((s) => s.modelInvocable)].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const query = typeof args?.query === "string" ? args.query.trim() : "";
      if (isBrowseCatalogQuery(query)) {
        if (listed.length === 0) {
          return { content: "No model-invocable skills available." };
        }
        return {
          content: [
            `Skill names (${listed.length}) — keyword query returns blurbs; skill loads body:`,
            formatNameList(listed, SKILL_SEARCH_LIST_MAX_CHARS),
          ].join("\n"),
        };
      }
      const rawLimit =
        typeof args?.limit === "number" && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : limitDefault;
      const limit = Math.min(Math.max(1, rawLimit), limitDefault);
      const hits = searchSkillsByQuery(listed, query, limit);
      if (hits.length === 0) {
        return {
          content: `No skills matched ${JSON.stringify(query)}. Tip: query \`list\` to browse names.`,
        };
      }
      return {
        content: [
          `Matched ${hits.length} skill(s) — call skill with the exact name to load the body:`,
          formatBlurbHits(hits),
        ].join("\n"),
      };
    },
    isConcurrencySafe: () => true,
  };
}
