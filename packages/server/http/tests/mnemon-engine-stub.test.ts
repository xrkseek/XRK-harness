import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  handleMnemonRead,
  handleMnemonWrite,
  buildMnemonStatus,
} from "../src/dsh-compat/mnemon.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("mnemon document engine", () => {
  it("search, graph, and bodies answer from stored documents", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-mnemon-eng-"));
    temps.push(home);
    handleMnemonWrite(
      "document",
      {
        id: "alpha",
        title: "Harbor notes",
        body: "Tide tables for [[lighthouse]] #coast",
      },
      { xrkHome: home },
    );
    handleMnemonWrite(
      "document",
      {
        id: "beta",
        title: "Inland",
        body: "See Harbor notes before sailing.",
      },
      { xrkHome: home },
    );

    const docs = handleMnemonRead("documents", { xrkHome: home });
    expect(Array.isArray(docs)).toBe(true);

    const search = handleMnemonRead(
      "search",
      { xrkHome: home },
      { query: "lighthouse" },
    ) as {
      incomplete?: string[];
      engine?: string;
      items?: Array<{ id: string }>;
    };
    expect(search.incomplete).toBeUndefined();
    expect(search.engine).toBe("mnemon-documents");
    expect(search.items?.map((item) => item.id)).toEqual(["alpha"]);

    const graph = handleMnemonRead("graph", { xrkHome: home }) as {
      incomplete?: string[];
      nodes?: Array<{ id: string; kind: string }>;
      edges?: Array<{ from: string; to: string }>;
    };
    expect(graph.incomplete).toBeUndefined();
    expect(graph.nodes?.some((node) => node.id === "alpha")).toBe(true);
    expect(graph.nodes?.some((node) => node.id === "wiki:lighthouse")).toBe(true);
    expect(
      graph.edges?.some(
        (edge) => edge.from === "beta" && edge.to === "alpha",
      ),
    ).toBe(true);

    const bodies = handleMnemonRead("bodies", { xrkHome: home }) as {
      incomplete?: string[];
      items?: Array<{ id: string; bytes: number }>;
    };
    expect(bodies.incomplete).toBeUndefined();
    expect(bodies.items?.map((item) => item.id).sort()).toEqual(["alpha", "beta"]);
    expect(bodies.items?.every((item) => item.bytes > 0)).toBe(true);

    const related = handleMnemonRead(
      "related",
      { xrkHome: home },
      { id: "alpha" },
    ) as { items?: Array<{ id: string }> };
    expect(related.items?.some((item) => item.id === "beta")).toBe(true);
  });

  it("status lists memory bodies derived from documents", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-mnemon-st-"));
    temps.push(home);
    const empty = buildMnemonStatus({ xrkHome: home }) as {
      documents?: { activeCount?: number };
      memoryBodies?: unknown[];
    };
    expect(empty.documents?.activeCount).toBe(0);
    expect(empty.memoryBodies).toEqual([]);

    handleMnemonWrite(
      "upsert",
      { title: "One", body: "turn:t-9" },
      { xrkHome: home },
    );
    const status = buildMnemonStatus({ xrkHome: home }) as {
      memoryBodies?: Array<{ title: string }>;
      providerServices?: Array<{ activeMemoryBodyCount: number }>;
    };
    expect(status.memoryBodies).toHaveLength(1);
    expect(status.providerServices?.[0]?.activeMemoryBodyCount).toBe(1);

    const turns = handleMnemonRead(
      "turn-activities",
      { xrkHome: home },
      { turnId: "t-9" },
    ) as { incomplete?: string[]; items?: unknown[] };
    expect(turns.incomplete).toBeUndefined();
    expect(turns.items).toHaveLength(1);
  });
});
