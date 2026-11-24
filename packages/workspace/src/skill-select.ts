/**
 * Skill catalog selection under a char budget (Codex dynamic_skill_selector
 * subset). `select` prefers relevant skills that still fit; `shadow` only
 * records the selection for offline eval and does not change prompt bytes.
 */

import { scoreFuzzyQuery } from "@xrkseek/core-tools";
import type { SkillSummary } from "./skills.js";

export type SkillSelectMode = "truncate" | "select" | "shadow";

export interface SkillSelectOptions {
  readonly mode?: SkillSelectMode;
  /** Free-text goal / turn query used to score skills. */
  readonly query?: string;
}

export interface SkillSelectionResult {
  readonly mode: SkillSelectMode;
  /** Skills that would be shown under `select`. */
  readonly selected: readonly SkillSummary[];
  /** Scores for every model-invocable skill (name → score). */
  readonly scores: Readonly<Record<string, number>>;
}

/** Higher is better. Empty query → 0 (stable order preserved). */
export function scoreSkillAgainstQuery(
  skill: SkillSummary,
  query: string | undefined,
): number {
  const q = query?.trim();
  if (!q) return 0;
  const hay = [skill.name, skill.description, skill.whenToUse ?? ""].join("\n");
  return scoreFuzzyQuery(q, hay, { name: skill.name });
}

/**
 * Greedy pack: highest score first, then original order, until the XML-ish
 * estimate exceeds `maxChars`. Always keeps at least the first skill when
 * the list is non-empty and maxChars > 0.
 */
export function selectSkillsForBudget(
  skills: readonly SkillSummary[],
  maxChars: number,
  query?: string,
): SkillSelectionResult {
  const listed = skills.filter((s) => s.modelInvocable);
  const scores: Record<string, number> = {};
  for (const s of listed) {
    scores[s.name] = scoreSkillAgainstQuery(s, query);
  }
  const ranked = [...listed].sort((a, b) => {
    const d = (scores[b.name] ?? 0) - (scores[a.name] ?? 0);
    if (d !== 0) return d;
    return listed.indexOf(a) - listed.indexOf(b);
  });

  // Match standing inject (names-only); blurbs live in skill_search.
  const lineOf = (s: SkillSummary) => `- \`${s.name}\`\n`;
  const overhead =
    "<system-reminder>\n<available_skills>\n</available_skills>\n</system-reminder>\n"
      .length + 120;
  let used = overhead;
  const selected: SkillSummary[] = [];
  for (const s of ranked) {
    const cost = lineOf(s).length;
    if (selected.length > 0 && used + cost > maxChars) break;
    if (selected.length === 0 && maxChars > 0 && cost + overhead > maxChars) {
      // Still keep one entry so the catalog is non-empty when budget is tiny.
      selected.push(s);
      break;
    }
    if (used + cost > maxChars && selected.length > 0) break;
    selected.push(s);
    used += cost;
  }

  return {
    mode: "select",
    selected,
    scores,
  };
}

export function recordShadowSkillSelection(
  skills: readonly SkillSummary[],
  maxChars: number,
  query?: string,
): SkillSelectionResult {
  const result = selectSkillsForBudget(skills, maxChars, query);
  return { ...result, mode: "shadow" };
}
