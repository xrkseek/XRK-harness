import { describe, expect, it } from "vitest";
import { appearanceLookWire } from "../src/agent-roster-store.js";
import {
  HELD_BUILTINS,
  dressingFromPresence,
  parseSlotPick,
} from "../src/presence-dressing.js";
import { validateSettingsNamespace } from "../src/settings-document.js";

describe("presence dressing kitHeld", () => {
  it("accepts builtin held kits on Settings mutate", () => {
    expect(parseSlotPick("flower", HELD_BUILTINS)).toBe("flower");
    expect(validateSettingsNamespace("ui-presence", { kitHeld: "flower" })).toBeUndefined();
    expect(validateSettingsNamespace("ui-presence", { kitHeld: "tea" })).toBeUndefined();
    expect(validateSettingsNamespace("ui-presence", { kitHeld: "wand" })).toContain("kitHeld");
  });

  it("reads kitHeld from persisted ui-presence user", () => {
    expect(dressingFromPresence({ kitHeld: "spark" }).kitHeld).toBe("spark");
  });

  it("wires builtin kitHeld onto companion look", () => {
    expect(appearanceLookWire({
      shape: "blob",
      color: "cream",
      kitHeld: "flag",
    }).kitHeld).toBe("flag");
  });
});
