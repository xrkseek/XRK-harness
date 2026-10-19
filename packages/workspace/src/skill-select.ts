/**
 * Skill catalog selection under a char budget (Codex dynamic_skill_selector
 * subset). `select` prefers relevant skills that still fit; `shadow` only
 * records the selection for offline eval and does not change prompt bytes.
 */

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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fff]+/i)
    .filter((t) => t.length >= 2);
}

/** Higher is better. Empty query → uniform 0 (stable order preserved). */
export function scoreSkillAgainstQuery(
  skill: SkillSummary,
  query: string | undefined,
): number {
  const q = query?.trim();
  if (!q) return 0;
  const tokens = new Set(tokenize(q));
  if (tokens.size === 0) return 0;
  const hay = tokenize(
    [skill.name, skill.description, skill.whenToUse ?? ""].join(" "),
  );
  let hits = 0;
  for (const t of hay) {
    if (tokens.has(t)) hits += 1;
  }
  // Exact name mention is a strong signal.
  if (tokens.has(skill.name.toLowerCase())) hits += 3;
  return hits;
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

  const lineOf = (s: SkillSummary) => `- \`${s.name}\`: ${s.description}\n`;
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
