import { describe, expect, it } from "vitest";
import { appearanceLookWire, parseOverlayImage } from "../src/agent-roster-store.js";
import {
  HELD_BUILTINS,
  dressingFromPresence,
  parseOverlayImage as parsePresenceOverlay,
  parseSlotPick,
  parseStickers,
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

describe("presence overlay SVG stickers", () => {
  const canonical =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";

  it("normalizes FileReader SVG forms and accepts them on Settings mutate", () => {
    const withCharset =
      "data:image/svg+xml;charset=utf-8;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    const encoded =
      "data:image/svg+xml;charset=utf-8,"
      + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(parsePresenceOverlay(withCharset)).toBe(canonical);
    expect(parsePresenceOverlay(encoded)).toBe(canonical);
    expect(parseOverlayImage(canonical)).toBe(canonical);

    const id = "stk_abcdef12mf7r";
    const stickers = JSON.stringify([{ id, image: encoded, slot: "glasses" }]);
    expect(validateSettingsNamespace("ui-presence", {
      stickers,
      kitGlasses: `sticker:${id}`,
      overlayGlasses: withCharset,
    })).toBeUndefined();

    const rows = parseStickers(stickers);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slot).toBe("glasses");
    expect(rows[0]?.image).toBe(canonical);
  });
});
