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
});
