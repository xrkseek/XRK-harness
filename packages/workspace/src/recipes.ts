import { readFile } from "node:fs/promises";
import path from "node:path";

export interface RecipeParam {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface Recipe {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly prompt: string;
  readonly instructions?: string;
  readonly parameters: readonly RecipeParam[];
}

/** Minimal YAML subset parser for our recipe files (no dependency). */
export function parseRecipeYaml(text: string): Recipe {
  const id = matchField(text, "id");
  const title = matchField(text, "title");
  const description = matchField(text, "description") || undefined;
  const prompt = matchBlock(text, "prompt") ?? "";
  const instructions = matchBlock(text, "instructions") || undefined;
  const parameters: RecipeParam[] = [];
  const paramBlock = text.split(/^parameters:\s*$/m)[1] ?? "";
  const nameRe = /^\s+-\s+name:\s*(\S+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(paramBlock))) {
    const name = m[1]!;
    const slice = paramBlock.slice(m.index, m.index + 200);
    const required = /required:\s*true/.test(slice);
    const desc = /description:\s*(.+)/.exec(slice)?.[1]?.trim();
    parameters.push({
      name,
      ...(desc ? { description: desc } : {}),
      ...(required ? { required: true } : {}),
    });
  }
  if (!id || !title) {
    throw new Error("recipe yaml missing id/title");
  }
  return {
    id,
    title,
    ...(description ? { description } : {}),
    prompt,
    ...(instructions ? { instructions } : {}),
    parameters,
  };
}

function matchField(text: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.+)\\s*$`, "m");
  return re.exec(text)?.[1]?.trim() ?? "";
}

function matchBlock(text: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*\\|\\s*\\n([\\s\\S]*?)(?=\\n\\w|$)`, "m");
  const m = re.exec(text);
  if (!m) return undefined;
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
}

export async function loadRecipeFile(filePath: string): Promise<Recipe> {
  const text = await readFile(filePath, "utf8");
  return parseRecipeYaml(text);
}

/** Expand `{{param}}` placeholders. */
export function applyRecipe(
  recipe: Recipe,
  values: Record<string, string>,
): { systemExtra: string; userPrompt: string } {
  for (const p of recipe.parameters) {
    if (p.required && (values[p.name] === undefined || values[p.name] === "")) {
      throw new Error(`recipe ${recipe.id}: missing param ${p.name}`);
    }
  }
  let prompt = recipe.prompt;
  for (const [k, v] of Object.entries(values)) {
    prompt = prompt.replaceAll(`{{${k}}}`, v);
  }
  return {
    systemExtra: recipe.instructions ?? "",
    userPrompt: prompt,
  };
}

export async function loadOfficeRecipes(
  recipesDir: string,
): Promise<readonly Recipe[]> {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(recipesDir).catch(() => [] as string[]);
  const out: Recipe[] = [];
  for (const name of names) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    out.push(await loadRecipeFile(path.join(recipesDir, name)));
  }
  return out;
}

/** Later lists override earlier entries with the same `id`. */
export function mergeRecipesById(
  ...lists: readonly (readonly Recipe[])[]
): Recipe[] {
  const map = new Map<string, Recipe>();
  for (const list of lists) {
    for (const recipe of list) map.set(recipe.id, recipe);
  }
  return [...map.values()];
}
