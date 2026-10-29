// Short-query recall: the FTS index is built with `tokenize='trigram'`, and a
// trigram index only holds runs of three or more code points. Chinese
// two-character words and short acronyms are exactly the queries users type
// most, so they must not fall through the index into "no results".
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { createPersistentSessionStore, planFtsQuery } from "../src/index.js";

type Store = ReturnType<typeof createPersistentSessionStore>;

let dir = "";
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-fts-short-"));
  store = createPersistentSessionStore(dir);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

let seeded = 0;

function seed(texts: readonly string[]): string {
  const id = store.create(`s${seeded++}`).id;
  store.append(id, { type: "turn/start", ts: 0, turnId: "t1" });
  texts.forEach((text, i) => {
    store.append(id, {
      type: "assistant/chunk",
      ts: i + 1,
      turnId: "t1",
      stepId: "s1",
      text,
      kind: "text",
      index: 0,
    } as SessionEvent);
  });
  store.flush();
  return id;
}

describe("planFtsQuery", () => {
  it("counts code points, not UTF-16 units", () => {
    // Two emoji are two characters to the tokenizer; slicing them as UTF-16
    // would read four and wrongly take the MATCH path.
    expect(planFtsQuery("🐟🐟")).toEqual({ kind: "like", value: "%🐟🐟%" });
  });

  it("routes on the three-code-point boundary", () => {
    expect(planFtsQuery("ab")).toEqual({ kind: "like", value: "%ab%" });
    expect(planFtsQuery("abc")).toEqual({ kind: "match", value: '"abc"' });
    expect(planFtsQuery("部署")).toEqual({ kind: "like", value: "%部署%" });
    expect(planFtsQuery("部署方案")).toEqual({ kind: "match", value: '"部署方案"' });
  });

  it("drops an empty query instead of matching everything", () => {
    expect(planFtsQuery("   ")).toBeNull();
  });

  it("escapes LIKE metacharacters in a short needle", () => {
    expect(planFtsQuery("a%")).toEqual({ kind: "like", value: "%a\\%%" });
    expect(planFtsQuery("a_")).toEqual({ kind: "like", value: "%a\\_%" });
    expect(planFtsQuery("a\\")).toEqual({ kind: "like", value: "%a\\\\%" });
  });
});

describe("searchSessionIds short queries", () => {
  it("finds a Chinese two-character word that the trigram index cannot hold", () => {
    const hit = seed(["今天部署了 0.6.23 "]);
    const other = seed(["完全无关的内容 "]);
    expect(store.searchSessionIds("部署")).toContain(hit);
    expect(store.searchSessionIds("部署")).not.toContain(other);
  });

  it("finds a two-letter acronym", () => {
    const hit = seed(["AI 助手与 PR 流程 "]);
    expect(store.searchSessionIds("AI")).toContain(hit);
    expect(store.searchSessionIds("PR")).toContain(hit);
  });

  it("keeps the three-character path working", () => {
    const hit = seed(["部署方案已上线 "]);
    expect(store.searchSessionIds("部署方案")).toContain(hit);
  });

  it("treats LIKE metacharacters literally", () => {
    const literal = seed(["进度 a%z 完成 "]);
    const wildcard = seed(["进度 abz 完成 "]);
    const hits = store.searchSessionIds("a%");
    expect(hits).toContain(literal);
    expect(hits).not.toContain(wildcard);
  });
});
