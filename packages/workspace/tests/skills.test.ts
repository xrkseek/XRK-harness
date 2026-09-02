import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSkillTools,
  formatSkillCatalog,
  isSkillName,
  listSkills,
  listSkillsFromWorkspace,
  loadSkill,
  parseSkillMarkdown,
} from "../src/index.js";

describe("skills", () => {
  it("rejects path-like names", () => {
    expect(isSkillName("office-ping")).toBe(true);
    expect(isSkillName("../secret")).toBe(false);
    expect(isSkillName("a/b")).toBe(false);
    expect(isSkillName("")).toBe(false);
  });

  it("parses frontmatter and lists SKILL.md dirs only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-"));
    const product = path.join(root, ".xrk");
    const dir = path.join(product, "skills", "office-ping");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---
name: office-ping
description: Ping skill for tests
whenToUse: when testing skill.list
---
# Office ping

Do the ping.
`,
      "utf8",
    );
    await writeFile(path.join(product, "skills", "not-a-dir"), "x", "utf8");

    const listed = await listSkills({ productDir: product });
    expect(listed).toEqual([
      {
        name: "office-ping",
        description: "Ping skill for tests",
        whenToUse: "when testing skill.list",
        modelInvocable: true,
        userInvocable: true,
        dirName: "office-ping",
        directory: dir,
      },
    ]);
    expect(formatSkillCatalog(listed)).toContain("**office-ping**");
    const loaded = await loadSkill({ productDir: product, name: "office-ping" });
    expect(loaded?.content).toContain("Do the ping.");
    expect(parseSkillMarkdown("---\nname: x\n---\n# Hi", "x").content).toBe(
      "# Hi",
    );
  });

  it("imports .claude and .xrk when present; skips missing roots", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "xrk-skill-multi-"));
    const claudeDir = path.join(ws, ".claude", "skills", "from-claude");
    const xrkDir = path.join(ws, ".xrk", "skills", "from-xrk");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(xrkDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, "SKILL.md"),
      "---\nname: from-claude\ndescription: Claude skill\n---\n# C\n",
      "utf8",
    );
    await writeFile(
      path.join(xrkDir, "SKILL.md"),
      "---\nname: from-xrk\ndescription: XRK skill\n---\n# X\n",
      "utf8",
    );
    const listed = await listSkillsFromWorkspace(ws, { includeUserHome: false });
    expect(listed.map((s) => s.name).sort()).toEqual(["from-claude", "from-xrk"]);
    expect(
      await loadSkill({
        workspaceRoot: ws,
        includeUserHome: false,
        name: "from-claude",
      }),
    ).toMatchObject({ name: "from-claude" });
  });

  it(".xrk wins over .claude on the same skill name", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "xrk-skill-overlay-"));
    const claudeDir = path.join(ws, ".claude", "skills", "shared");
    const xrkDir = path.join(ws, ".xrk", "skills", "shared");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(xrkDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, "SKILL.md"),
      "---\nname: shared\ndescription: from claude\n---\n# Claude\n",
      "utf8",
    );
    await writeFile(
      path.join(xrkDir, "SKILL.md"),
      "---\nname: shared\ndescription: from xrk\n---\n# Xrk\n",
      "utf8",
    );
    const listed = await listSkillsFromWorkspace(ws, { includeUserHome: false });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.description).toBe("from xrk");
    expect(listed[0]?.directory).toBe(xrkDir);
  });

  it("skill tool loads body and rejects unknown names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-"));
    const product = path.join(root, ".xrk");
    const dir = path.join(product, "skills", "notes");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "# Notes\nKeep it short.\n", "utf8");
    const tool = createSkillTools({ productDir: product }).find(
      (t) => t.name === "skill",
    )!;
    const ok = await tool.execute({ name: "notes" });
    expect(ok.isError).toBeUndefined();
    expect(ok.content).toContain("<skill_content name=\"notes\">");
    expect(ok.content).toContain("Keep it short.");
    expect(ok.content).toContain(dir);
    const miss = await tool.execute({ name: "missing" });
    expect(miss.isError).toBe(true);
    expect(tool.presentCall?.({ name: "notes" })).toEqual({
      card: "generic",
      title: "Load skill notes",
      kind: "read",
      rawInput: "notes",
    });
  });

  it("honors disable-model-invocation and drops invalid flags", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-flags-"));
    const product = path.join(root, ".xrk");
    const notes = path.join(product, "skills", "repo-notes");
    const bad = path.join(product, "skills", "bad-flag");
    await mkdir(notes, { recursive: true });
    await mkdir(bad, { recursive: true });
    await writeFile(
      path.join(notes, "SKILL.md"),
      `---
name: repo-notes
description: Coding-agent notes
disable-model-invocation: true
user-invocable: false
---
# Notes only
`,
      "utf8",
    );
    await writeFile(
      path.join(bad, "SKILL.md"),
      `---
name: bad-flag
description: Bad
disable-model-invocation: maybe
---
# Dropped
`,
      "utf8",
    );
    const listed = await listSkills({ productDir: product });
    expect(listed.map((s) => s.name)).toEqual(["repo-notes"]);
    expect(listed[0]?.modelInvocable).toBe(false);
    expect(listed[0]?.userInvocable).toBe(false);
    expect(formatSkillCatalog(listed)).toBeUndefined();

    const tool = createSkillTools({ productDir: product }).find(
      (t) => t.name === "skill",
    )!;
    const denied = await tool.execute({ name: "repo-notes" });
    expect(denied.isError).toBe(true);
    expect(String(denied.content)).toMatch(/not model-invocable/);
  });
});

describe("skills frontmatter YAML block scalars", () => {
  it("folds `description: >-` continuation lines into one description", () => {
    const parsed = parseSkillMarkdown(
      `---
name: xrk-capability-attach
description: >-
  Attach external tools via MCP in XRK-Harness Settings (paste mcpServers JSON,
  allow connect, confirm before mutate). Use when the user asks to install MCP,
  add tools, connect a server, or 「装 MCP」「挂工具」.
---
# Attach capability (MCP)
`,
      "xrk-capability-attach",
    );
    expect(parsed.name).toBe("xrk-capability-attach");
    expect(parsed.description).toBe(
      "Attach external tools via MCP in XRK-Harness Settings (paste mcpServers JSON, allow connect, confirm before mutate). Use when the user asks to install MCP, add tools, connect a server, or 「装 MCP」「挂工具」.",
    );
    // Regression: the bare indicator used to become the whole description.
    expect(parsed.description).not.toBe(">-");
    expect(parsed.invalid).toBe(false);
    expect(parsed.content).toBe("# Attach capability (MCP)");
  });

  it("still reads keys that follow a block scalar", () => {
    const parsed = parseSkillMarkdown(
      `---
description: >-
  folded
  text
whenToUse: after the block
disable-model-invocation: true
---
Body
`,
      "k",
    );
    expect(parsed.description).toBe("folded text");
    expect(parsed.whenToUse).toBe("after the block");
    expect(parsed.modelInvocable).toBe(false);
  });

  it("keeps newlines for a literal `|-` block scalar", () => {
    const parsed = parseSkillMarkdown(
      `---
name: claude-api
description: |-
  Reference for the Claude API.
  TRIGGER — read BEFORE opening the target file.
license: Complete terms in LICENSE.txt
---
# Body
`,
      "claude-api",
    );
    expect(parsed.description).toBe(
      "Reference for the Claude API.\nTRIGGER — read BEFORE opening the target file.",
    );
    // The trailing `license` key must not be swallowed by the block scalar.
    expect(parsed.content).toBe("# Body");
  });

  it("does not treat a value that merely starts with > or | as a block", () => {
    expect(
      parseSkillMarkdown(
        "---\ndescription: >50% less code, per the benchmark\n---\n# B\n",
        "k",
      ).description,
    ).toBe(">50% less code, per the benchmark");
    expect(
      parseSkillMarkdown("---\ndescription: |pipe| separated\n---\n# B\n", "k")
        .description,
    ).toBe("|pipe| separated");
  });

  it("supports chomping and explicit indent indicators", () => {
    expect(
      parseSkillMarkdown("---\ndescription: >+\n  a\n  b\n---\nX\n", "k")
        .description,
    ).toBe("a b");
    expect(
      parseSkillMarkdown("---\ndescription: |2\n  a\n  b\n---\nX\n", "k")
        .description,
    ).toBe("a\nb");
  });

  it("ignores blank lines inside a block scalar and trims its edges", () => {
    expect(
      parseSkillMarkdown(
        "---\ndescription: >-\n\n  a\n\n  b\n\nname: n\n---\nX\n",
        "k",
      ).description,
    ).toBe("a b");
  });

  it("still fails closed on a non-boolean flag next to a block scalar", () => {
    const parsed = parseSkillMarkdown(
      `---
description: >-
  folded
disable-model-invocation: maybe
---
# Body
`,
      "bad",
    );
    expect(parsed.description).toBe("folded");
    expect(parsed.invalid).toBe(true);
  });

  it("falls back to the first body line when a block scalar is empty", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: n\ndescription: >-\n---\n# Real heading\n",
      "n",
    );
    expect(parsed.description).toBe("Real heading");
  });
});
