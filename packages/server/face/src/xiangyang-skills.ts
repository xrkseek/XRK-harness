/**
 * Seed 向阳空间-only skills under the workspace `.xrk/skills` tree.
 * Other workspaces do not get these files (workspace-scoped catalog).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

interface XiangyangSkillSeed {
  readonly id: string;
  readonly body: string;
}

const SKILLS: readonly XiangyangSkillSeed[] = [
  {
    id: "xrk-xrk-cleanup",
    body: [
      "---",
      "name: xrk-xrk-cleanup",
      "description: >-",
      "  Reclaim disk under ~/.xrk and project .xrk (caches, orphans, temp).",
      "  Use when Harness litter grows or the user asks to tidy .xrk.",
      "---",
      "",
      "# .xrk 垃圾清理",
      "",
      "范围：`~/.xrk` 与各工作区 `.xrk`（缓存、空 recipes、过期归档、明显 temp）。",
      "",
      "1. 先列体积与路径清单，确认后删；优先大文件与明确临时产物。",
      "2. 保留：`settings.yaml` · `.credentials.yaml` · `sessions.db` · 用户改过的 skills。",
      "3. 跨工作区：`workspace_list` → `workspace_session_prompt` 派清理，或本会话直接处理（full access）。",
      "",
    ].join("\n"),
  },
  {
    id: "xrk-skill-merge",
    body: [
      "---",
      "name: xrk-skill-merge",
      "description: >-",
      "  Merge overlapping skills across ~/.xrk/skills and workspace layers.",
      "  Use when skills duplicate, conflict, or the catalog is noisy.",
      "---",
      "",
      "# 技能合并优化",
      "",
      "1. 对照 `~/.xrk/skills` 与工作区 `.xrk/skills` / `.agents/skills`。",
      "2. 合并重复：真源一份；更新 `description` 触发词。",
      "3. 用户改过的 SKILL.md：缺才写，或征得同意再改。",
      "4. 合并后抽查 skill 工具 / `/skills`。",
      "",
    ].join("\n"),
  },
  {
    id: "xrk-memory-polish",
    body: [
      "---",
      "name: xrk-memory-polish",
      "description: >-",
      "  Polish curated memory (MEMORY.md): prune stale, fill gaps.",
      "  Use when memory is noisy, incomplete, or after long projects.",
      "---",
      "",
      "# 记忆完善",
      "",
      "1. 读 MEMORY.md / Curated memory 现状。",
      "2. 软删过时；补用户要求长期记住的事实。",
      "3. 不写密钥与一次性调试噪声。",
      "4. 改完用短摘要回报。",
      "",
    ].join("\n"),
  },
  {
    id: "xrk-plugin-dev-care",
    body: [
      "---",
      "name: xrk-plugin-dev-care",
      "description: >-",
      "  Author and verify xrkh process plugins (tools/prompt/commands/…).",
      "  Use when building extensions for XRK-Harness.",
      "---",
      "",
      "# 插件开发",
      "",
      "1. 落点 `extensions/<id>/`；读 plugin-development 规格。",
      "2. kind：`tools` · `prompt` · `commands` · `channel` · `policy` · `llm`。",
      "3. 验证：`xrkh plugin`；密钥走 Credentials。",
      "",
    ].join("\n"),
  },
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write missing skill folders under the 向阳空间 workspace (idempotent).
 * @param xiangyangRoot - Absolute path of the reserved workspace directory.
 */
export async function seedXiangyangSkills(
  xiangyangRoot: string,
): Promise<{ installed: string[] }> {
  const skillsRoot = path.join(xiangyangRoot, ".xrk", "skills");
  await mkdir(skillsRoot, { recursive: true });
  const installed: string[] = [];
  for (const skill of SKILLS) {
    const dir = path.join(skillsRoot, skill.id);
    const file = path.join(dir, "SKILL.md");
    if (await exists(file)) continue;
    await mkdir(dir, { recursive: true });
    await writeFile(file, skill.body, "utf8");
    installed.push(skill.id);
  }
  return { installed };
}
