import { describe, expect, it } from "vitest";
import { en, zh } from "../src/client/locales.ts";
import {
  HOST_DESCRIPTION_KEYS,
  localizeHostCommandDescription,
} from "../src/client/host-description.ts";

describe("localizeHostCommandDescription", () => {
  it("translates canonical Host English rows for the active locale", () => {
    const t = (key: keyof typeof zh) => zh[key];
    expect(
      localizeHostCommandDescription(
        "compact",
        en["description.compact"],
        t,
      ),
    ).toBe(zh["description.compact"]);
    expect(
      localizeHostCommandDescription(
        "goal",
        en["description.goal"],
        t,
      ),
    ).toBe(zh["description.goal"]);
  });

  it("leaves plugin or scoped overrides verbatim", () => {
    expect(
      localizeHostCommandDescription(
        "compact",
        "plugin-authored copy",
        (key) => zh[key],
      ),
    ).toBe("plugin-authored copy");
    expect(
      localizeHostCommandDescription(
        "goal",
        "scoped goal override",
        (key) => zh[key],
      ),
    ).toBe("scoped goal override");
  });

  it("covers every built-in Host name with matching en dictionary copy", () => {
    for (const [name, key] of HOST_DESCRIPTION_KEYS) {
      expect(en[key].length).toBeGreaterThan(0);
      expect(zh[key].length).toBeGreaterThan(0);
      expect(name.length).toBeGreaterThan(0);
    }
    expect(HOST_DESCRIPTION_KEYS.size).toBe(13);
  });

  it("rewrites the Face recipe expand trailer for the UI locale", () => {
    const t = (key: keyof typeof zh) => zh[key];
    expect(
      localizeHostCommandDescription(
        "code-review",
        "Read-only defect-first review (load xrk-code-review) (expands into the prompt)",
        t,
      ),
    ).toBe(
      `Read-only defect-first review (load xrk-code-review)${zh["recipe.expandSuffix"]}`,
    );
  });
});
