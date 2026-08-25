import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  appendWorkspaceInjectsIfChanged,
  buildSkillCatalogPayload,
  createWorkspaceInjector,
  foldLatestWorkspaceInjectDigests,
  planWorkspaceInjectAppends,
} from "../src/index.js";

function memoryStore() {
  const events: SessionEvent[] = [];
  return {
    get() {
      return { events };
    },
    append(_id: string, event: SessionEvent) {
      events.push(event);
      return event;
    },
    events,
  };
}

describe("durable workspace inject", () => {
  it("builds skill-catalog + agent-instructions payloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ws-d-"));
    const product = path.join(root, ".xrk");
    await mkdir(path.join(product, "skills", "skill-a"), { recursive: true });
    await writeFile(path.join(product, "assistant.md"), "Hello assistant", "utf8");
    await writeFile(
      path.join(product, "skills", "skill-a", "SKILL.md"),
      "---\ndescription: Alpha skill\n---\n# Body\n",
      "utf8",
    );

    const out = await createWorkspaceInjector({
      root,
      productDir: product,
      includeUserHome: false,
    }).inject();
    expect(out.instructions?.source.kind).toBe("agent-instructions");
    expect(out.instructions?.content).toContain("## .xrk/assistant.md");
    expect(out.skillCatalog?.source.kind).toBe("skill-catalog");
    expect(out.skillCatalog?.source.entries).toEqual([
      { name: "skill-a", description: "Alpha skill" },
    ]);
    expect(out.skillCatalog?.content).toContain("<available_skills>");
    expect(out.instructionBlocks.some((b) => b.startsWith("## Skills"))).toBe(
      false,
    );
  });

  it("planWorkspaceInjectAppends is idempotent on same digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ws-d2-"));
    const product = path.join(root, ".xrk");
    await mkdir(product, { recursive: true });
    await writeFile(path.join(product, "assistant.md"), "A", "utf8");
    const durable = await createWorkspaceInjector({
      root,
      productDir: product,
      includeUserHome: false,
    }).inject();
    const first = planWorkspaceInjectAppends({
      durable,
      previous: {},
    });
    expect(first.length).toBeGreaterThan(0);
    const previous = {
      ...(durable.instructions?.digest
        ? { instructions: durable.instructions.digest }
        : {}),
      ...(durable.skillCatalog?.digest
        ? { skillCatalog: durable.skillCatalog.digest }
        : {}),
    };
    expect(
      planWorkspaceInjectAppends({ durable, previous }).length,
    ).toBe(0);
  });

  it("appendWorkspaceInjectsIfChanged writes once then skips", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ws-d3-"));
    const product = path.join(root, ".xrk");
    await mkdir(path.join(product, "skills", "ping"), { recursive: true });
    await writeFile(path.join(product, "assistant.md"), "Assist", "utf8");
    await writeFile(
      path.join(product, "skills", "ping", "SKILL.md"),
      "---\ndescription: Ping\n---\n# P\n",
      "utf8",
    );

    const store = memoryStore();
    const injectOptions = { root, productDir: product };
    const injector = createWorkspaceInjector({
      root,
      productDir: product,
      includeUserHome: false,
    });

    const a1 = await appendWorkspaceInjectsIfChanged({
      store,
      sessionId: "s1",
      turnId: "t1",
      now: () => 1,
      injectOptions,
      injector,
    });
    expect(a1.some((x) => x.source.kind === "skill-catalog")).toBe(true);
    expect(a1.some((x) => x.source.kind === "agent-instructions")).toBe(true);

    const a2 = await appendWorkspaceInjectsIfChanged({
      store,
      sessionId: "s1",
      turnId: "t2",
      now: () => 2,
      injectOptions,
      injector,
    });
    expect(a2).toEqual([]);

    expect(await injector.isDiskUnchanged()).toBe(true);

    const digests = foldLatestWorkspaceInjectDigests(store.events);
    expect(digests.skillCatalog).toBeTruthy();
    expect(digests.instructions).toBeTruthy();
  });

  it("clips durable skill catalog to inject budget (DSH progressive disclosure)", () => {
    const skills = Array.from({ length: 40 }, (_, i) => ({
      name: `skill-${i}`,
      description: `Description for skill number ${i}`,
      modelInvocable: true,
      userInvocable: true,
      dirName: `skill-${i}`,
      directory: `/tmp/skill-${i}`,
    }));
    const budget = { left: 400, events: [] as import("../src/index.js").WorkspaceBudgetEvent[] };
    const payload = buildSkillCatalogPayload(skills, budget);
    expect(payload).toBeDefined();
    expect(payload!.content.length).toBeLessThanOrEqual(400 + 32);
    expect(payload!.content).toContain("[skill catalog truncated]");
    expect(payload!.source.entries.length).toBeLessThan(skills.length);
  });

  it("memoizes inject across turns when injector is reused", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ws-memo-"));
    const product = path.join(root, ".xrk");
    await mkdir(path.join(product, "skills", "ping"), { recursive: true });
    await writeFile(path.join(product, "assistant.md"), "Assist", "utf8");
    await writeFile(
      path.join(product, "skills", "ping", "SKILL.md"),
      "---\ndescription: Ping\n---\n# P\n",
      "utf8",
    );
    const injector = createWorkspaceInjector({
      root,
      productDir: product,
      includeUserHome: false,
    });
    const first = await injector.inject();
    const second = await injector.inject();
    expect(second).toBe(first);
  });
});
