import { describe, expect, it } from "vitest";
import {
  appearanceLookWire,
  MEMBER_COLORS,
  parseMemberBallSize,
  parseOverlayImage,
} from "../src/agent-roster-store.js";
import {
  GLASSES_BUILTINS,
  HAT_BUILTINS,
  HELD_BUILTINS,
  dressingFromPresence,
  parseOverlayImage as parsePresenceOverlay,
  parseSlotPick,
  parseStickers,
} from "../src/presence-dressing.js";
import { validateSettingsNamespace } from "../src/settings-document.js";

/* Ball size is a *trim* (0.8–1.2 on a 0.02 grid): the stage keeps its slot and
 * only the ball inside it scales. The client half carries the same numbers in
 * `PRESENCE_SIZE_*` / `BALL_SIZE_*`; this pins the Host validator to them. */
describe("member ball size trim", () => {
  it("accepts the 0.8–1.2 grid", () => {
    expect(parseMemberBallSize(1)).toBe(1);
    expect(parseMemberBallSize(0.8)).toBe(0.8);
    expect(parseMemberBallSize(1.2)).toBe(1.2);
    expect(parseMemberBallSize("0.96")).toBe(0.96);
  });

  it("snaps onto the 0.02 grid, not onto tenths", () => {
    expect(parseMemberBallSize(0.81)).toBe(0.82);
    expect(parseMemberBallSize(1.19)).toBe(1.2);
  });

  it("drops the retired 0.6–1.6 zoom range and junk", () => {
    expect(parseMemberBallSize(0.6)).toBeUndefined();
    expect(parseMemberBallSize(1.6)).toBeUndefined();
    expect(parseMemberBallSize(Number.NaN)).toBeUndefined();
    expect(parseMemberBallSize("nope")).toBeUndefined();
    expect(parseMemberBallSize(null)).toBeUndefined();
  });
});

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

/* The boss seat (`ui-presence`) is gated by Host-side enumerations, while roster
 * members (经理 / 干员) store `kitHat` / `kitGlasses` / `kitHeld` as free strings.
 * A gate that lags the client therefore reads as "老板换了装扮又弹回空的, 经理却没事".
 * Pin every gate to the shipped ids so the lists cannot silently drift again. */
describe("boss seat dressing gates match the shipped kits", () => {
  it("accepts every hat / glasses / held the picker offers", () => {
    expect(HAT_BUILTINS).toHaveLength(19);
    expect(GLASSES_BUILTINS).toHaveLength(13);
    expect(HELD_BUILTINS).toHaveLength(24);
    for (const hat of ["crown", "cake", "cat-ears", "flower-crown", "headphones", "bucket", "beret"]) {
      expect(parseSlotPick(hat, HAT_BUILTINS)).toBe(hat);
      expect(validateSettingsNamespace("ui-presence", { kitHat: hat })).toBeUndefined();
    }
    for (const glasses of ["specs-heart", "specs-monocle", "specs-shades", "specs-round-xl"]) {
      expect(parseSlotPick(glasses, GLASSES_BUILTINS)).toBe(glasses);
      expect(validateSettingsNamespace("ui-presence", { kitGlasses: glasses })).toBeUndefined();
    }
    for (const held of [
      "icecream",
      "guitar",
      "camera",
      "balloon",
      "umbrella",
      "brand-wechat",
      "brand-deepseek",
      "brand-github",
      "brand-xrk",
    ]) {
      expect(parseSlotPick(held, HELD_BUILTINS)).toBe(held);
      expect(validateSettingsNamespace("ui-presence", { kitHeld: held })).toBeUndefined();
    }
  });

  it("keeps the 28-color palette writable, not just renderable", () => {
    expect(MEMBER_COLORS).toHaveLength(28);
    expect(new Set(MEMBER_COLORS).size).toBe(28);
    for (const color of ["midnight", "gold", "frost", "twilight", "jade"]) {
      expect(validateSettingsNamespace("ui-presence", { color })).toBeUndefined();
    }
  });

  it("reads a boss look back without rewriting the new ids to none", () => {
    const look = dressingFromPresence({
      kitHat: "cake",
      kitGlasses: "specs-heart",
      kitHeld: "balloon",
    });
    expect(look.kitHat).toBe("cake");
    expect(look.kitGlasses).toBe("specs-heart");
    expect(look.kitHeld).toBe("balloon");
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
