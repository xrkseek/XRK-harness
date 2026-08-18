import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly modelInvocable: boolean;
  /** Directory under `{productDir}/skills`. */
  readonly dirName: string;
  readonly directory: string;
}

export interface SkillDefinition extends SkillSummary {
  /** Markdown body with YAML frontmatter stripped. */
  readonly content: string;
}

const MAX_NAME = 128;

export function isSkillName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME) return false;
  if (trimmed === "." || trimmed === "..") return false;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return false;
  }
  return true;
}

export function parseSkillMarkdown(
  raw: string,
  fallbackName: string,
): { readonly name: string; readonly description: string; readonly whenToUse?: string; readonly content: string } {
  let body = raw.replace(/^\uFEFF/, "");
  let name = fallbackName;
  let description = "";
  let whenToUse: string | undefined;

  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end > 0) {
      const fm = body.slice(3, end).trim();
      body = body.slice(end + 4).replace(/^\r?\n/, "");
      for (const line of fm.split(/\r?\n/)) {
        const m = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1]!;
        const val = m[2]!.replace(/^["']|["']$/g, "").trim();
        if (key === "name" && val) name = val;
        if (key === "description" && val) description = val;
        if ((key === "whenToUse" || key === "when_to_use") && val) {
          whenToUse = val;
        }
      }
    }
  }

  const content = body.trim();
  if (!description) {
    const first = content
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0);
    description = first ?? name;
  }

  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    content,
  };
}

export async function listSkills(options: {
  readonly productDir: string;
}): Promise<readonly SkillSummary[]> {
  const root = path.resolve(options.productDir, "skills");
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: SkillSummary[] = [];
  for (const dirName of names) {
    if (!isSkillName(dirName)) continue;
    const directory = path.join(root, dirName);
    try {
      const st = await stat(directory);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = path.join(directory, "SKILL.md");
    let parsed: ReturnType<typeof parseSkillMarkdown>;
    try {
      const raw = await readFile(skillFile, "utf8");
      parsed = parseSkillMarkdown(raw, dirName);
    } catch {
      parsed = {
        name: dirName,
        description: dirName,
        content: "",
      };
    }
    if (!isSkillName(parsed.name)) continue;
    out.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
      modelInvocable: true,
      dirName,
      directory,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function listSkillsFromWorkspace(
  workspaceRoot: string,
): Promise<readonly SkillSummary[]> {
  return listSkills({
    productDir: path.resolve(workspaceRoot, ".xrk"),
  });
}

export async function loadSkill(options: {
  readonly productDir: string;
  readonly name: string;
}): Promise<SkillDefinition | undefined> {
  const wanted = options.name.trim();
  if (!isSkillName(wanted)) return undefined;
  const listed = await listSkills({ productDir: options.productDir });
  const summary = listed.find(
    (s) => s.name === wanted || s.dirName === wanted,
  );
  if (!summary) return undefined;
  const skillFile = path.join(summary.directory, "SKILL.md");
  let parsed: ReturnType<typeof parseSkillMarkdown>;
  try {
    const raw = await readFile(skillFile, "utf8");
    parsed = parseSkillMarkdown(raw, summary.dirName);
  } catch {
    return {
      ...summary,
      content: "",
    };
  }
  return {
    ...summary,
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
    content: parsed.content,
  };
}

export function formatSkillCatalog(
  skills: readonly SkillSummary[],
): string | undefined {
  if (skills.length === 0) return undefined;
  const lines = skills.map((s) => {
    const extra = s.whenToUse ? ` When to use: ${s.whenToUse}` : "";
    return `- **${s.name}**: ${s.description}.${extra}`;
  });
  return [
    "## Skills",
    ...lines,
    "Use the skill tool with the exact name to load full instructions before acting on a matching task.",
  ].join("\n");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Model-facing load payload. Directory skills resolve relative paths from `directory`. */
export function renderSkillContent(skill: SkillDefinition): string {
  return [
    `<skill_content name="${escapeAttr(skill.name)}">`,
    "<skill_resources>",
    `Base directory for this skill: ${skill.directory}`,
    "Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.",
    "</skill_resources>",
    "",
    "<skill_instructions>",
    skill.content,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}

export const SKILL_TOOL_GUIDANCE =
  "Use the skill tool to load the full instructions for an available skill listed in the Skills catalog. Call it with the exact skill name before acting on a task that names or clearly matches that skill.";
