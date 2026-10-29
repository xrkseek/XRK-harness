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

  it("co-injects .agents + .claude + .cursor + .codex + root when all present", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco-multi-")),
    );
    await mkdir(path.join(root, ".agents", "rules"), { recursive: true });
    await mkdir(path.join(root, ".claude", "rules"), { recursive: true });
    await mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), "# Root AGENTS\nRoot handbook.", "utf8");
    await writeFile(
      path.join(root, ".agents", "AGENTS.md"),
      "# Agents overlay\nAgents handbook.",
      "utf8",
    );
    await writeFile(
      path.join(root, ".claude", "CLAUDE.md"),
      "# Claude project\nClaude handbook.",
      "utf8",
    );
    await writeFile(
      path.join(root, ".claude", "rules", "style.md"),
      "# Claude style\nPrefer short diffs.",
      "utf8",
    );
    await writeFile(
      path.join(root, ".cursor", "rules", "node.mdc"),
      "---\ndescription: Node\n---\n# Cursor rule\nNode ≥26\n",
      "utf8",
    );
    await writeFile(
      path.join(root, ".codex", "AGENTS.md"),
      "# Codex agents\nCodex handbook.",
      "utf8",
    );

    const out = await createWorkspaceInjector({ root }).inject();
    const joined = out.instructionBlocks.join("\n");
    expect(joined).toContain("Root handbook");
    expect(joined).toContain("Agents handbook");
    expect(joined).toContain("Claude handbook");
    expect(joined).toContain("Prefer short diffs");
    expect(joined).toContain("Node ≥26");
    expect(joined).toContain("Codex handbook");
    expect(joined).toContain("## .agents/AGENTS.md");
    expect(joined).toContain("## .claude/CLAUDE.md");
    expect(joined).toContain("## .cursor/rules/node.mdc");
    expect(joined).toContain("## .codex/AGENTS.md");
  });

  it("subagent keeps product standing and home convention; only XRK.md is gated", async () => {
    const fs = await import("node:fs/promises");
    const root = await fs.mkdtemp(path.join(tmpdir(), "xrk-eco-sub-"));
    const home = await fs.mkdtemp(path.join(tmpdir(), "xrk-eco-home-"));
    const homeProduct = path.join(home, ".xrk");
    await mkdir(homeProduct, { recursive: true });
    await mkdir(path.join(home, ".agents"), { recursive: true });
    await writeFile(
      path.join(homeProduct, "AGENTS.md"),
      "# Product seed\nYou are the user's agent. Small asks: do them yourself.",
      "utf8",
    );
    await writeFile(
      path.join(homeProduct, "SOUL.md"),
      "Product soul tone.",
      "utf8",
    );
    await writeFile(
      path.join(home, ".agents", "AGENTS.md"),
      "# Home convention draft\nCross-project draft only.",
      "utf8",
    );
    await writeFile(
      path.join(root, "AGENTS.md"),
      "# Repo rules\nRun pnpm check before shipping.",
      "utf8",
    );

    const userOut = await createWorkspaceInjector({
      root,
      homeDir: home,
    }).inject();
    const userJoined = userOut.instructionBlocks.join("\n");
    expect(userJoined).toContain("Small asks: do them yourself");
    expect(userJoined).toContain("Cross-project draft only");

    const subOut = await createWorkspaceInjector({
      root,
      homeDir: home,
      audience: "subagent",
    }).inject();
    const joined = subOut.instructionBlocks.join("\n");
    expect(joined).toContain("Small asks: do them yourself");
    expect(joined).toContain("Product soul tone");
    expect(joined).toContain("Cross-project draft only");
    expect(joined).toContain("Run pnpm check before shipping");
  });

  it("manager-only XRK.md reaches user audience; subagent/minimal skip", async () => {
    const fs = await import("node:fs/promises");
    const root = await fs.mkdtemp(path.join(tmpdir(), "xrk-eco-ledger-"));
    const home = await fs.mkdtemp(path.join(tmpdir(), "xrk-eco-ledger-home-"));
    const homeProduct = path.join(home, ".xrk");
    const wsProduct = path.join(root, ".xrk");
    await mkdir(homeProduct, { recursive: true });
    await mkdir(wsProduct, { recursive: true });
    await writeFile(
      path.join(homeProduct, "AGENTS.md"),
      "# Product seed\nShared standing.",
      "utf8",
    );
    await writeFile(
      path.join(homeProduct, "XRK.md"),
      "# Standing manager ledger\nStanding XRK note.",
      "utf8",
    );
    await writeFile(
      path.join(wsProduct, "XRK.md"),
      "# Workspace standing ledger\nWorkspace XRK overlay.",
      "utf8",
    );
    await writeFile(
      path.join(home, "XRK.md"),
      "# Home manager ledger\nManager-only home note.",
      "utf8",
    );
    await writeFile(
      path.join(root, "XRK.md"),
      "# Project manager ledger\nManager-only project note.",
      "utf8",
    );
    await writeFile(
      path.join(root, "AGENTS.md"),
      "# Repo rules\nShared project rules.",
      "utf8",
    );

    const userJoined = (
      await createWorkspaceInjector({ root, homeDir: home }).inject()
    ).instructionBlocks.join("\n");
    expect(userJoined).toContain("Standing XRK note");
    expect(userJoined).toContain("Workspace XRK overlay");
    expect(userJoined).toContain("Manager-only home note");
    expect(userJoined).toContain("Manager-only project note");
    expect(userJoined).toContain("Shared standing");

    for (const audience of ["subagent", "minimal"] as const) {
      const joined = (
        await createWorkspaceInjector({
          root,
          homeDir: home,
          audience,
        }).inject()
      ).instructionBlocks.join("\n");
      expect(joined).toContain("Shared standing");
      expect(joined).not.toContain("Standing XRK note");
      expect(joined).not.toContain("Workspace XRK overlay");
      expect(joined).not.toContain("Manager-only home note");
      expect(joined).not.toContain("Manager-only project note");
      expect(joined).toContain("Shared project rules");
    }
  });

  it("minimal audience keeps standing + home convention like subagent", async () => {
    const fs = await import("node:fs/promises");
    const root = await fs.mkdtemp(path.join(tmpdir(), "xrk-eco-min-"));
    const home = await fs.mkdtemp(path.join(tmpdir(), "xrk-eco-min-home-"));
    const homeProduct = path.join(home, ".xrk");
    await mkdir(homeProduct, { recursive: true });
    await mkdir(path.join(home, ".agents"), { recursive: true });
    await writeFile(
      path.join(homeProduct, "AGENTS.md"),
      "# Product seed\nYou are the user's agent. Small asks: do them yourself.",
      "utf8",
    );
    await writeFile(
      path.join(home, ".agents", "AGENTS.md"),
      "# Home convention draft\nCross-project draft only.",
      "utf8",
    );
    await writeFile(
      path.join(root, "AGENTS.md"),
      "# Repo rules\nRun pnpm check before shipping.",
      "utf8",
    );
    const out = await createWorkspaceInjector({
      root,
      homeDir: home,
      audience: "minimal",
    }).inject();
    const joined = out.instructionBlocks.join("\n");
    expect(joined).toContain("Small asks: do them yourself");
    expect(joined).toContain("Cross-project draft only");
    expect(joined).toContain("Run pnpm check before shipping");
  });

  it("tags every instruction section with its source path", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco-prov-")),
    );
    await writeFile(path.join(root, "AGENTS.md"), "# Repo", "utf8");
    const out = await createWorkspaceInjector({ root }).inject();
    const agentsBlock = out.instructionBlocks.find((b) =>
      b.startsWith("## AGENTS.md"),
    );
    expect(agentsBlock).toBeTruthy();
    expect(agentsBlock).toContain("> source: AGENTS.md");
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

  it("injects root AGENTS.md alongside .xrk overlay unless xrk-inject:false", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(tmpdir(), "xrk-eco4-")),
    );
    const product = path.join(root, ".xrk");
    await mkdir(product, { recursive: true });
    await writeFile(
      path.join(root, "AGENTS.md"),
      "# Root project AGENTS\nRoot project handbook.",
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
    expect(joined).toContain("Root project handbook");

    await writeFile(
      path.join(root, "AGENTS.md"),
      "---\nxrk-inject: false\n---\n# Maintainer AGENTS\nDo not inject to product agent.\n",
      "utf8",
    );
    const opted = await createWorkspaceInjector({
      root,
      productDir: product,
    }).inject();
    const optedJoined = opted.instructionBlocks.join("\n");
    expect(optedJoined).toContain("Product plugin workspace");
    expect(optedJoined).not.toContain("Do not inject to product agent");
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
