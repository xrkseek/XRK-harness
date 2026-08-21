import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  appendWorkspaceInjectsIfChanged,
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

    const out = await createWorkspaceInjector({ root, productDir: product }).inject();
    expect(out.instructions?.source.kind).toBe("agent-instructions");
    expect(out.instructions?.content).toContain("## Assistant");
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

    const a1 = await appendWorkspaceInjectsIfChanged({
      store,
      sessionId: "s1",
      turnId: "t1",
      now: () => 1,
      injectOptions,
    });
    expect(a1.some((x) => x.source.kind === "skill-catalog")).toBe(true);
    expect(a1.some((x) => x.source.kind === "agent-instructions")).toBe(true);

    const a2 = await appendWorkspaceInjectsIfChanged({
      store,
      sessionId: "s1",
      turnId: "t2",
      now: () => 2,
      injectOptions,
    });
    expect(a2).toEqual([]);

    const digests = foldLatestWorkspaceInjectDigests(store.events);
    expect(digests.skillCatalog).toBeTruthy();
    expect(digests.instructions).toBeTruthy();
  });
});
