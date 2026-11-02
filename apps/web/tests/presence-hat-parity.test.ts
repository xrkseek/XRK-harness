import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "apps/web/public/presence/emotion-ball";
const read = (f: string): string => readFileSync(`${DIR}/${f}`, "utf8");

/** Hat ids the SVG path (`ball.js`) can actually draw. */
function svgHats(src: string): string[] {
  const ids = [...src.matchAll(/kind === '([a-z-]+)'/g)].map((m) => m[1]!);
  const specSuffix = /^specs/;
  const held = new Set([
    "flower", "tea", "flag", "spark", "balloon", "umbrella", "pencil",
    "book", "camera", "guitar", "lamp", "icecream", "string",
  ]);
  return [...new Set(ids)].filter((id) => id !== "none" && !specSuffix.test(id) && !held.has(id)).sort();
}

/** Hat ids the Canvas2D path (`canvas-ball.js`) can actually draw. */
function canvasHats(src: string): string[] {
  const ids = [...src.matchAll(/kitHat === '([a-z-]+)'/g)].map((m) => m[1]!);
  return [...new Set(ids)].filter((id) => id !== "none").sort();
}

/** Palette keys of the per-hat colour table. */
function paletteKeys(src: string): string[] {
  const i = src.indexOf("HAT_PALETTES = {");
  const body = src.slice(i, src.indexOf("};", i));
  return [...body.matchAll(/^\s+'?([a-z-]+)'?: \{/gm)].map((m) => m[1]!).sort();
}

describe("presence hat parity", () => {
  it("canvas draws every hat the SVG path draws", () => {
    const svg = svgHats(read("ball.js"));
    const canvas = canvasHats(read("canvas-ball.js"));
    expect(svg).toHaveLength(18);
    expect(canvas).toEqual(svg);
  });

  it("both render paths carry the same per-hat palette", () => {
    const svg = paletteKeys(read("ball.js"));
    const canvas = paletteKeys(read("canvas-ball.js"));
    expect(svg).toHaveLength(18);
    expect(canvas).toEqual(svg);
  });

  it("every hat with a fixed palette has a draw branch", () => {
    const svg = new Set(svgHats(read("ball.js")));
    for (const id of paletteKeys(read("ball.js"))) expect(svg.has(id)).toBe(true);
  });

  it("no hat falls back to a pure body-colour derive", () => {
    /* The whole complaint: 18 hats, one colour. Each needs its own crown/brim/
     * accent (or the role it actually paints with). */
    const src = read("ball.js");
    for (const id of paletteKeys(src)) {
      const i = src.indexOf(`      ${id}: {`);
      const at = i < 0 ? src.indexOf(`      '${id}': {`) : i;
      expect(at).toBeGreaterThan(-1);
      const row = src.slice(at, src.indexOf("},", at));
      expect(row).toMatch(/#[0-9A-Fa-f]{6}/);
    }
  });
});
