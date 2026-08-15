import {
  loadOfficeRecipes,
  tryApplySlashRecipe,
  type Recipe,
} from "@xrkseek/workspace";
import type { FaceRpcResult } from "./types.js";

export type SlashRecipesLoader = () => Promise<readonly Recipe[]> | readonly Recipe[];

export function defaultRecipesLoader(workspaceRoot: string): SlashRecipesLoader {
  return () => loadOfficeRecipes(`${workspaceRoot}/.xrk/recipes`);
}

/**
 * Face-level slash: expand recipe → command slot; never admit.
 * Unknown `/id` → honest error (no fake success).
 */
export async function tryFaceSlashCommand(
  text: string,
  loadRecipes: SlashRecipesLoader | undefined,
): Promise<FaceRpcResult<{
  accepted: true;
  command: { kind: "success" | "error"; text: string; recipeId?: string };
}> | undefined> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const recipes = loadRecipes ? await loadRecipes() : [];
  const hit = tryApplySlashRecipe(trimmed, recipes);
  if (hit) {
    return {
      ok: true,
      value: {
        accepted: true,
        command: {
          kind: "success",
          text: hit.userPrompt,
          recipeId: hit.recipeId,
        },
      },
    };
  }
  const id = trimmed.slice(1).split(/\s/)[0] ?? "";
  return {
    ok: true,
    value: {
      accepted: true,
      command: {
        kind: "error",
        text: id
          ? `unknown slash recipe: ${id}`
          : "invalid slash command",
      },
    },
  };
}
