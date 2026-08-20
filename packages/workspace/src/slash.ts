import { applyRecipe, type Recipe } from "./recipes.js";
import {
  loadSkill,
  renderSkillContent,
  type SkillSourceOptions,
} from "./skills.js";

export interface SlashCommand {
  readonly id: string;
  /** Remainder after `/id` (trimmed). */
  readonly rest: string;
}

export interface SlashRecipeResult {
  readonly recipeId: string;
  readonly userPrompt: string;
  readonly systemExtra: string;
}

/**
 * Parse `/recipe-id optional rest…`.
 * Returns undefined when the text is not a slash invocation.
 */
export function parseSlashCommand(text: string): SlashCommand | undefined {
  const t = text.trim();
  if (!t.startsWith("/")) return undefined;
  const m = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/u.exec(t);
  if (!m?.[1]) return undefined;
  return { id: m[1], rest: (m[2] ?? "").trim() };
}

/**
 * Map slash rest → recipe param values.
 * - one required param → entire rest
 * - else: `key=value` or `key: value` tokens (whitespace-separated pairs)
 */
export function mapSlashRestToValues(
  recipe: Recipe,
  rest: string,
): Record<string, string> {
  const required = recipe.parameters.filter((p) => p.required);
  if (required.length === 1 && required[0]) {
    return { [required[0].name]: rest };
  }
  const values: Record<string, string> = {};
  if (!rest) return values;
  const pairRe = /([a-zA-Z0-9_-]+)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(rest))) {
    const key = m[1]!;
    let val = m[2]!;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  return values;
}

/**
 * If `text` is `/id …` and `id` matches a recipe, expand prompt + instructions.
 * Unknown slash ids return undefined (caller keeps raw text).
 */
export function tryApplySlashRecipe(
  text: string,
  recipes: readonly Recipe[],
): SlashRecipeResult | undefined {
  const parsed = parseSlashCommand(text);
  if (!parsed) return undefined;
  const recipe = recipes.find((r) => r.id === parsed.id);
  if (!recipe) return undefined;
  const values = mapSlashRestToValues(recipe, parsed.rest);
  const applied = applyRecipe(recipe, values);
  return {
    recipeId: recipe.id,
    userPrompt: applied.userPrompt,
    systemExtra: applied.systemExtra,
  };
}

/**
 * `/skill-name optional remainder`. Full body is prepended to the logged
 * user prompt (session-reconstructable). Recipe ids win when both exist.
 */
export async function tryApplySlashSkill(
  text: string,
  source: SkillSourceOptions | string,
): Promise<SlashRecipeResult | undefined> {
  const parsed = parseSlashCommand(text);
  if (!parsed) return undefined;
  const opts: SkillSourceOptions =
    typeof source === "string" ? { productDir: source } : source;
  const skill = await loadSkill({ ...opts, name: parsed.id });
  if (!skill) return undefined;
  const body = renderSkillContent(skill);
  const userPrompt = parsed.rest ? `${body}\n\n${parsed.rest}` : body;
  return {
    recipeId: skill.name,
    userPrompt,
    systemExtra: "",
  };
}

/** Recipe first, then skill. Used by presets as `assemble.resolveSlash`. */
export function createSlashResolver(options: {
  readonly productDir?: string;
  readonly workspaceRoot?: string;
  readonly recipes?: readonly Recipe[];
}): (
  raw: string,
) => Promise<SlashRecipeResult | undefined> {
  const recipes = options.recipes ?? [];
  const skillSource: SkillSourceOptions = {
    ...(options.workspaceRoot !== undefined
      ? { workspaceRoot: options.workspaceRoot }
      : {}),
    ...(options.productDir !== undefined
      ? { productDir: options.productDir }
      : {}),
  };
  return async (raw) => {
    const recipe = tryApplySlashRecipe(raw, recipes);
    if (recipe) return recipe;
    return tryApplySlashSkill(raw, skillSource);
  };
}
