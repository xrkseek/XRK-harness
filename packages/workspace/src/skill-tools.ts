import type { ToolDefinition } from "@xrkseek/core-tools";
import { createSkillSearchTool } from "./skill-search.js";
import {
  isSkillName,
  loadSkill,
  renderSkillContent,
  type SkillDefinition,
  type SkillSourceOptions,
} from "./skills.js";

export function presentSkillCall(args: { name: string }): {
  readonly card: "generic";
  readonly title: string;
  readonly kind: "read";
  readonly rawInput: string;
} {
  return {
    card: "generic",
    title: `Load skill ${args.name}`,
    kind: "read",
    rawInput: args.name,
  };
}

export function createSkillTools(
  options: SkillSourceOptions,
): ToolDefinition[] {
  return [
    createSkillSearchTool(options),
    {
      name: "skill",
      description:
        "Load skill body by exact name (from catalog or skill_search). Prefer 公文包 / workspace head.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The exact skill name from the catalog or skill_search.",
          },
        },
        required: ["name"],
      },
      async execute(args) {
        const name = String((args as { name?: string }).name ?? "").trim();
        if (!isSkillName(name)) {
          return {
            content: `Error: invalid skill name "${name}"`,
            isError: true,
          };
        }
        const skill: SkillDefinition | undefined = await loadSkill({
          ...options,
          name,
        });
        if (!skill) {
          return {
            content: `Error: skill "${name}" is unknown or no longer available. Tip: skill_search to browse.`,
            isError: true,
          };
        }
        if (!skill.modelInvocable) {
          return {
            content: `Error: skill "${name}" is not model-invocable (notes / disable-model-invocation)`,
            isError: true,
          };
        }
        return { content: renderSkillContent(skill) };
      },
      presentCall: presentSkillCall,
      isConcurrencySafe: () => true,
    } satisfies ToolDefinition<{ name: string }>,
  ];
}
