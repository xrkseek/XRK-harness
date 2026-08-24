import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceInjector,
  isProductInjectPath,
} from "../src/index.js";

describe("WorkspaceInjector", () => {
  it("injects ecosystem paths in order and respects budget", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ws-"));
    const product = path.join(root, ".xrk");
    await mkdir(path.join(product, "context"), { recursive: true });
    await mkdir(path.join(product, "skills"), { recursive: true });
    await writeFile(path.join(product, "assistant.md"), "A", "utf8");
    await writeFile(path.join(product, "context", "c1.md"), "C", "utf8");
    await writeFile(path.join(product, "rules.md"), "R", "utf8");
    await mkdir(path.join(product, "skills", "skill-a"), { recursive: true });
    await writeFile(
      path.join(product, "skills", "skill-a", "SKILL.md"),
      "---\ndescription: Alpha\n---\n# A\n",
      "utf8",
    );
    await writeFile(path.join(product, "subagents.md"), "S", "utf8");
    await writeFile(path.join(root, "AGENTS.md"), "REPO AGENTS", "utf8");

    const inj = createWorkspaceInjector({
      root,
      productDir: product,
      includeUserHome: false,
    });
    const out = await inj.inject({ maxChars: 10_000 });
    expect(out.blocks.map((b) => b.split("\n")[0])).toEqual([
      "## .xrk/assistant.md",
      "## .xrk/context/c1.md",
      "## .xrk/rules.md",
      "## .xrk/subagents.md",
      "## AGENTS.md",
      "## Skills",
    ]);
    expect(out.blocks.join("\n")).toContain("**skill-a**");
    expect(out.blocks.join("\n")).toContain("REPO AGENTS");
  });

  it("isolates root AGENTS.md from product inject path", () => {
    expect(isProductInjectPath("/repo", "/repo/AGENTS.md")).toBe(false);
    expect(isProductInjectPath("/repo", "/repo/.xrk")).toBe(true);
  });
});
