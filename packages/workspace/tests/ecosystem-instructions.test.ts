import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceInjector } from "../src/index.js";

describe("ecosystem instruction inject", () => {
  it("includes AGENTS.md, .cursor/rules/*.mdc, and .xrk standing files", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco-")),
    );
    const product = path.join(root, ".xrk");
    await mkdir(path.join(product, "skills", "ping"), { recursive: true });
    await mkdir(path.join(root, ".cursor", "rules"), { recursive: true });

    await writeFile(
      path.join(root, "AGENTS.md"),
      "# Repo AGENTS\nHarness maintainer rules.",
      "utf8",
    );
    await writeFile(
      path.join(root, ".cursor", "rules", "node.mdc"),
      "---\ndescription: Node rule\nalwaysApply: true\n---\n# Node ≥26\n",
      "utf8",
    );
    await writeFile(path.join(product, "assistant.md"), "Assistant body", "utf8");
    await writeFile(path.join(product, "SOUL.md"), "Soul persona", "utf8");
    await writeFile(
      path.join(product, "skills", "ping", "SKILL.md"),
      "---\ndescription: Ping\n---\n# P\n",
      "utf8",
    );

    const out = await createWorkspaceInjector({ root, productDir: product }).inject();
    const joined = out.instructionBlocks.join("\n");
    expect(joined).toContain("## .cursor/rules/node.mdc");
    expect(joined).toContain("Node ≥26");
    expect(joined).toContain("## .xrk/assistant.md");
    expect(joined).toContain("## .xrk/SOUL.md");
    expect(joined).toContain("## AGENTS.md");
    expect(joined).toContain("Harness maintainer rules");
    expect(out.instructions?.source.changes?.map((c) => c.path)).toContain(
      "AGENTS.md",
    );
  });

  it("skips .cursor/rules/*.mdc with xrk-inject: false", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco3-")),
    );
    await mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "rules", "maintainer.mdc"),
      "---\ndescription: maintainer\nxrk-inject: false\n---\n# Maintainer only\n",
      "utf8",
    );
    await writeFile(
      path.join(root, ".cursor", "rules", "product.mdc"),
      "---\ndescription: product\n---\n# Product rule\n",
      "utf8",
    );

    const out = await createWorkspaceInjector({ root }).inject();
    const joined = out.instructionBlocks.join("\n");
    expect(joined).not.toContain("Maintainer only");
    expect(joined).toContain("Product rule");
  });

  it("skips root AGENTS.md when .agents/AGENTS.md defines product workspace role", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco4-")),
    );
    const product = path.join(root, ".xrk");
    await mkdir(product, { recursive: true });
    await writeFile(
      path.join(root, "AGENTS.md"),
      "# Maintainer AGENTS\nDo not inject to product agent.",
      "utf8",
    );
    await writeFile(
      path.join(product, "AGENTS.md"),
      "# Product plugin workspace AGENTS",
      "utf8",
    );

    const out = await createWorkspaceInjector({ root, productDir: product }).inject();
    const joined = out.instructionBlocks.join("\n");
    expect(joined).toContain("Product plugin workspace");
    expect(joined).not.toContain("Do not inject to product agent");
    expect(out.instructionBlocks.map((b) => b.split("\n")[0])).not.toContain(
      "## AGENTS.md",
    );
  });

  it("skips CLAUDE.md when it only imports AGENTS.md", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco2-")),
    );
    await writeFile(path.join(root, "AGENTS.md"), "Shared agents", "utf8");
    await writeFile(path.join(root, "CLAUDE.md"), "@AGENTS.md\n", "utf8");

    const out = await createWorkspaceInjector({ root }).inject();
    const paths = out.instructionBlocks.map((b) => b.split("\n")[0]);
    expect(paths).toContain("## AGENTS.md");
    expect(paths).not.toContain("## CLAUDE.md");
  });

  it("excludes user-home ~/.cursor/rules from Host inject", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco6-")),
    );
    const home = path.join(root, "home");
    await mkdir(path.join(home, ".cursor", "rules"), { recursive: true });
    await writeFile(
      path.join(home, ".cursor", "rules", "maintainer.mdc"),
      "---\ndescription: Cursor maintainer\n---\n# Cursor-only maintainer note\n",
      "utf8",
    );
    await mkdir(path.join(root, ".agents"), { recursive: true });
    await writeFile(
      path.join(root, ".agents", "AGENTS.md"),
      "# Project role\n",
      "utf8",
    );

    const { collectEcosystemInstructions, sectionsToInstructionBlocks } =
      await import("../src/ecosystem-instructions.js");
    const sections = await collectEcosystemInstructions({
      root,
      productDir: path.join(root, ".xrk"),
      budget: { left: 32_000, events: [] },
      includeUserHome: true,
      homeDir: home,
    });
    const joined = sectionsToInstructionBlocks(sections).join("\n");
    expect(joined).not.toContain("Cursor-only maintainer note");
    expect(joined).not.toContain("## ~/.cursor/rules/");
  });

  it("includes user-home ~/.agents rules before workspace overlay", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco5-")),
    );
    const home = path.join(root, "home");
    await mkdir(path.join(home, ".agents", "rules"), { recursive: true });
    await writeFile(
      path.join(home, ".agents", "AGENTS.md"),
      "# Global persona\nAlways be concise.",
      "utf8",
    );
    await writeFile(
      path.join(home, ".agents", "rules", "style.md"),
      "# Style\nUse plain language.",
      "utf8",
    );
    await mkdir(path.join(root, ".agents"), { recursive: true });
    await writeFile(
      path.join(root, ".agents", "AGENTS.md"),
      "# Project role\nWrite plugins under extensions/.",
      "utf8",
    );

    const { collectEcosystemInstructions, sectionsToInstructionBlocks } =
      await import("../src/ecosystem-instructions.js");
    const sections = await collectEcosystemInstructions({
      root,
      productDir: path.join(root, ".xrk"),
      budget: { left: 32_000, events: [] },
      includeUserHome: true,
      homeDir: home,
    });
    const joined = sectionsToInstructionBlocks(sections).join("\n");
    expect(joined).toContain("## ~/.agents/AGENTS.md");
    expect(joined).toContain("Always be concise");
    expect(joined).toContain("## .agents/AGENTS.md");
    expect(joined).toContain("Write plugins under extensions/");
    expect(joined.indexOf("Always be concise")).toBeLessThan(
      joined.indexOf("Write plugins"),
    );
  });
});
