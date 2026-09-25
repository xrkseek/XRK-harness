import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSessionModelSelections,
  saveSessionModelSelection,
  sessionModelsPath,
} from "../src/session-model-store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("session-model-store", () => {
  it("persists and reloads session overrides", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sm-"));
    dirs.push(dir);
    const file = sessionModelsPath(dir);
    saveSessionModelSelection(file, "sess-a", {
      provider: "deepseek",
      model: "deepseek-chat",
    });
    saveSessionModelSelection(file, "sess-b", {
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "high",
    });
    const map = loadSessionModelSelections(file);
    expect(map.get("sess-a")).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
    expect(map.get("sess-b")).toEqual({
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "high",
    });
  });
});
