import type { ToolDefinition } from "@xrkseek/core-tools";
import {
  isSkillName,
  loadSkill,
  renderSkillContent,
  type SkillDefinition,
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

export function createSkillTools(options: {
  readonly productDir: string;
}): ToolDefinition[] {
  const productDir = options.productDir;
  return [
    {
      name: "skill",
      description:
        "Load the full instructions for an available skill. Call this with the exact skill name from the session skill catalog before acting on a task that names or clearly matches that skill.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The exact skill name from the available skills list.",
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
          productDir,
          name,
        });
        if (!skill) {
          return {
            content: `Error: skill "${name}" is unknown or no longer available`,
            isError: true,
          };
        }
        return { content: renderSkillContent(skill) };
      },
      presentCall: presentSkillCall,
    } satisfies ToolDefinition<{ name: string }>,
  ];
}
