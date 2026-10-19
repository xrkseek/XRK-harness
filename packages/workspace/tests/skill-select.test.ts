import { describe, expect, it } from "vitest";
import {
  buildSkillCatalogPayload,
  formatAvailableSkillsXml,
} from "../src/durable-inject.js";
import { createInjectBudget } from "../src/inject-budget.js";
import {
  recordShadowSkillSelection,
  scoreSkillAgainstQuery,
  selectSkillsForBudget,
} from "../src/skill-select.js";
import type { SkillSummary } from "../src/skills.js";

function skill(
  name: string,
  description: string,
  whenToUse?: string,
): SkillSummary {
  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    content: "",
    modelInvocable: true,
    userInvocable: true,
    invalid: false,
  };
}

const LIBRARY = [
  skill("deploy", "Ship production releases to kubernetes", "deploy release kubernetes"),
  skill("lint", "Run eslint and formatters on the repo"),
  skill("memory", "Curate long-term agent memory notes"),
  skill("browser", "Drive a headed browser for UI checks"),
] as const;

describe("scoreSkillAgainstQuery", () => {
  it("scores name and description hits", () => {
    expect(scoreSkillAgainstQuery(LIBRARY[0]!, "deploy kubernetes release")).toBeGreaterThan(
      scoreSkillAgainstQuery(LIBRARY[1]!, "deploy kubernetes release"),
    );
    expect(scoreSkillAgainstQuery(LIBRARY[1]!, undefined)).toBe(0);
  });
});

describe("selectSkillsForBudget", () => {
  it("prefers query-relevant skills that still fit", () => {
    const packed = selectSkillsForBudget([...LIBRARY], 280, "deploy kubernetes");
    expect(packed.selected.map((s) => s.name)[0]).toBe("deploy");
    expect(packed.selected.length).toBeGreaterThanOrEqual(1);
    expect(packed.selected.length).toBeLessThan(LIBRARY.length);
  });

  it("keeps stable order when there is no query", () => {
    const packed = selectSkillsForBudget([...LIBRARY], 10_000);
    expect(packed.selected.map((s) => s.name)).toEqual(
      LIBRARY.map((s) => s.name),
    );
  });
});

describe("buildSkillCatalogPayload selection modes", () => {
  it("shadow records a selection without changing prompt bytes vs truncate", () => {
    const truncBudget = createInjectBudget(220);
    const shadowBudget = createInjectBudget(220);
    const truncated = buildSkillCatalogPayload([...LIBRARY], truncBudget);
    const shadowed = buildSkillCatalogPayload([...LIBRARY], shadowBudget, {
      selection: { mode: "shadow", query: "deploy kubernetes" },
    });
    expect(truncated?.content).toBeDefined();
    expect(shadowed?.content).toBe(truncated?.content);
    expect(shadowed?.digest).toBe(truncated?.digest);
    expect(shadowed?.selection?.mode).toBe("shadow");
    expect(shadowed?.selection?.selected[0]?.name).toBe("deploy");
    // Offline eval helper matches the same packing.
    const offline = recordShadowSkillSelection([...LIBRARY], 220, "deploy kubernetes");
    expect(offline.selected.map((s) => s.name)).toEqual(
      shadowed?.selection?.selected.map((s) => s.name),
    );
  });

  it("select packs a relevant subset instead of mid-catalog truncation alone", () => {
    const budget = createInjectBudget(260);
    const selected = buildSkillCatalogPayload([...LIBRARY], budget, {
      selection: { mode: "select", query: "browser ui" },
    });
    expect(selected?.selection?.mode).toBe("select");
    expect(selected?.content).toContain("browser");
    // Full catalog under the same budget would truncate; select should still be valid XML-ish.
    expect(selected?.content).toContain("<available_skills>");
    const full = formatAvailableSkillsXml([...LIBRARY]);
    expect(selected!.content.length).toBeLessThanOrEqual(full.length);
  });

  it("default truncate mode omits selection metadata", () => {
    const payload = buildSkillCatalogPayload([...LIBRARY], createInjectBudget(10_000));
    expect(payload?.selection).toBeUndefined();
    expect(payload?.content).toContain("deploy");
  });
});
