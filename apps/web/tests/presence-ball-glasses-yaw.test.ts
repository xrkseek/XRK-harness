/**
 * Worker canvas path: glasses sticker must follow the eyes through a yaw
 * and drop out once both lenses are on the far side of the turn.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BALL = path.join(ROOT, "apps/web/public/presence/emotion-ball");

/** Sticker lenses are per-eye half-crops: 9-arg drawImage(src…) + 5-arg fallback. */
interface Draw {
  readonly sx: number;
  readonly sw: number;
  readonly dx: number;
  readonly dw: number;
  readonly dh: number;
}

function loadCanvasBall(): {
  create(canvas: object, opts: Record<string, unknown>): {
    applyPose(pose: Record<string, unknown>): void;
  };
} {
  vm.runInThisContext(readFileSync(path.join(BALL, "rings.js"), "utf8"), {
    filename: "rings.js",
  });
  vm.runInThisContext(readFileSync(path.join(BALL, "canvas-ball.js"), "utf8"), {
    filename: "canvas-ball.js",
  });
  const eb = (globalThis as { EmotionBall?: { createBall?: unknown } }).EmotionBall;
  if (!eb?.createBall) throw new Error("canvas-ball did not register createBall");
  return { create: eb.createBall as never };
}

function pose(yaw: number): Record<string, unknown> {
  const rings = (globalThis as { EB_RINGS: { EXPRESSIONS: number[][][][] } }).EB_RINGS;
  const eye = (ring: number[][]) => ({
    ring,
    open: 1,
    scaleX: 1,
    scaleY: 1,
    x: 0,
    y: 0,
    lookX: 0,
    lookY: 0,
    rotate: 0,
    color: "#111111",
  });
  return {
    body: { yaw, x: 0, y: 0, rotate: 0, scale: 1, color: "#E8A87C", sketch: 0 },
    left: eye(rings.EXPRESSIONS[0]![0]!),
    right: eye(rings.EXPRESSIONS[0]![1]!),
  };
}

describe("presence glasses sticker follows yaw", () => {
  it("paints front-facing glasses and hides them once the turn occludes both eyes", () => {
    class ImageBitmap {}
    class HTMLCanvasElement {
      width = 256;
      height = 256;
      draws: Draw[] = [];
      getContext(): object {
        const canvas = this;
        const noop = (): void => {};
        return {
          setTransform: noop,
          clearRect: noop,
          save: noop,
          restore: noop,
          translate: noop,
          rotate: noop,
          scale: noop,
          beginPath: noop,
          moveTo: noop,
          lineTo: noop,
          quadraticCurveTo: noop,
          bezierCurveTo: noop,
          arc: noop,
          arcTo: noop,
          rect: noop,
          roundRect: noop,
          closePath: noop,
          fill: noop,
          stroke: noop,
          createRadialGradient: () => ({ addColorStop: noop }),
          drawImage(
            _img: unknown,
            a: number,
            b: number,
            c: number,
            d: number,
            e?: number,
            f?: number,
            g?: number,
            h?: number,
          ): void {
            /* 9-arg form crops one half of the sticker per eye. */
            if (e !== undefined && g !== undefined && h !== undefined) {
              canvas.draws.push({ sx: a, sw: c, dx: e, dw: g, dh: h });
            } else {
              canvas.draws.push({ sx: 0, sw: c, dx: a, dw: c, dh: d });
            }
          },
        };
      }
    }
    const g = globalThis as {
      HTMLCanvasElement?: unknown;
      ImageBitmap?: unknown;
    };
    const prevCanvas = g.HTMLCanvasElement;
    const prevBitmap = g.ImageBitmap;
    g.HTMLCanvasElement = HTMLCanvasElement;
    g.ImageBitmap = ImageBitmap;
    try {
      const { create } = loadCanvasBall();
      const canvas = new HTMLCanvasElement();
      const ball = create(canvas, {
        glassesImage: new ImageBitmap(),
        kitGlasses: "none",
        shape: "blob",
      });

      ball.applyPose(pose(0));
      // 左片取贴图左半幅、右片取右半幅 —— 两片各自压在各自的眼睛上。
      expect(canvas.draws).toHaveLength(2);
      const leftLens = canvas.draws[0]!;
      const rightLens = canvas.draws[1]!;
      expect(leftLens.sx).toBe(0);
      expect(rightLens.sx).toBe(48);
      expect(leftLens.sw).toBe(48);
      expect(rightLens.dx).toBeGreaterThan(leftLens.dx + 20);
      expect(leftLens.dw).toBeGreaterThan(30);

      canvas.draws.length = 0;
      ball.applyPose(pose(Math.PI / 5));
      expect(canvas.draws).toHaveLength(2);
      // 转头时两片一起收窄并向中线靠拢，仍各自贴着眼睛。
      expect(canvas.draws[0]!.dw).toBeLessThan(leftLens.dw);
      expect(canvas.draws[1]!.dw).toBeLessThan(rightLens.dw);
      expect(canvas.draws[1]!.dx).toBeGreaterThan(canvas.draws[0]!.dx);

      canvas.draws.length = 0;
      ball.applyPose(pose(Math.PI));
      expect(canvas.draws).toEqual([]);
    } finally {
      g.HTMLCanvasElement = prevCanvas;
      g.ImageBitmap = prevBitmap;
    }
  });

  it("reserves viewBox / canvas headroom so hats are not sheared flat", () => {
    const ballSrc = readFileSync(path.join(BALL, "ball.js"), "utf8");
    const canvasSrc = readFileSync(path.join(BALL, "canvas-ball.js"), "utf8");
    const cssSrc = readFileSync(
      path.join(ROOT, "packages/client/ui-plan/src/client/PresenceBall.module.css"),
      "utf8",
    );
    expect(ballSrc).toMatch(/viewBox:\s*'-15 -100 259 344'/);
    expect(canvasSrc).toMatch(/ORIGIN_Y = -100/);
    expect(canvasSrc).toMatch(/VIEW_H = 344/);
    /* Size trim is a *shrink inside a fixed stage*: the bitmap box is 5/6 of
     * the stage (83.3333% = 1/1.2) and centred, so the 120% end fills the stage
     * exactly and the box itself never grows — hats cannot be sheared flat. */
    expect(cssSrc).toMatch(/\.mount\s*\{[^}]*top:\s*50%;/s);
    expect(cssSrc).toMatch(/\.mount\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)/s);
    expect(cssSrc).toMatch(
      /\.mount\s*\{[^}]*width:\s*calc\(83\.3333%\s*\*\s*var\(--ball-size,\s*1\)\)/s,
    );
    expect(cssSrc).toMatch(/\.mount\s*\{[^}]*overflow:\s*visible/s);
    expect(cssSrc).toMatch(/\.mount\s*\{[^}]*contain:\s*layout style/s);
    expect(cssSrc).not.toMatch(/\.mount\s*\{[^}]*contain:\s*strict/s);
  });

  it("keeps halo through a full spin and lifts hats off the crown", () => {
    class HTMLCanvasElement {
      width = 256;
      height = 256;
      strokes = 0;
      getContext(): object {
        const canvas = this;
        const noop = (): void => {};
        return {
          setTransform: noop,
          clearRect: noop,
          save: noop,
          restore: noop,
          translate: noop,
          rotate: noop,
          scale: noop,
          beginPath: noop,
          moveTo: noop,
          lineTo: noop,
          closePath: noop,
          fill: noop,
          stroke: (): void => { canvas.strokes += 1; },
          fillRect: noop,
          ellipse: noop,
          quadraticCurveTo: noop,
          bezierCurveTo: noop,
          arc: noop,
          arcTo: noop,
          rect: noop,
          roundRect: noop,
          createRadialGradient: () => ({ addColorStop: noop }),
          drawImage: noop,
        };
      }
    }
    const g = globalThis as { HTMLCanvasElement?: unknown };
    const prev = g.HTMLCanvasElement;
    g.HTMLCanvasElement = HTMLCanvasElement;
    try {
      const { create } = loadCanvasBall();
      const canvas = new HTMLCanvasElement();
      const ball = create(canvas, { kitHat: "halo", shape: "blob" });
      let spins = 0;
      for (let i = 0; i <= 12; i++) {
        canvas.strokes = 0;
        ball.applyPose(pose((i / 12) * Math.PI * 2));
        if (canvas.strokes > 0) spins += 1;
      }
      // Halo must paint at every yaw sample through a click spin.
      expect(spins).toBe(13);

      const cap = new HTMLCanvasElement();
      const capBall = create(cap, { kitHat: "cap", shape: "blob" });
      cap.strokes = 0;
      capBall.applyPose(pose(0));
      // Cap path uses fill, not stroke — just ensure front still draws without throw.
      expect(() => capBall.applyPose(pose(Math.PI))).not.toThrow();
      // Edge-on still has room (was cn<=0.08 hide); behind-head hides.
      const src = readFileSync(path.join(BALL, "canvas-ball.js"), "utf8");
      expect(src).toMatch(/cn <= -0\.12/);
      // 帽子高度表与 SVG 版逐项同源：halo 浮空、其余压在脑门上。
      expect(src).toMatch(/halo: -28/);
      expect(src).toMatch(/crown: 1/);
      expect(src).toMatch(/'flower-crown': 1/);
      expect(src).not.toMatch(/cn <= 0\.08/);
    } finally {
      g.HTMLCanvasElement = prev;
    }
  });

  it("draws rect, cat-eye, and sunglasses as different lens primitives", () => {
    class HTMLCanvasElement {
      width = 256;
      height = 256;
      marks: string[] = [];
      getContext(): object {
        const canvas = this;
        const noop = (): void => {};
        const mark = (name: string) => (): void => { canvas.marks.push(name); };
        return {
          setTransform: noop,
          clearRect: noop,
          save: noop,
          restore: noop,
          translate: noop,
          rotate: noop,
          scale: noop,
          beginPath: noop,
          moveTo: noop,
          lineTo: noop,
          closePath: noop,
          fill: noop,
          stroke: noop,
          lineCap: "",
          lineWidth: 1,
          fillStyle: "",
          strokeStyle: "",
          createRadialGradient: () => ({ addColorStop: noop }),
          ellipse: mark("ellipse"),
          rect: mark("rect"),
          roundRect: mark("roundRect"),
          bezierCurveTo: mark("bezier"),
          quadraticCurveTo: mark("bridge"),
          drawImage: noop,
        };
      }
    }
    const g = globalThis as { HTMLCanvasElement?: unknown };
    const prev = g.HTMLCanvasElement;
    g.HTMLCanvasElement = HTMLCanvasElement;
    try {
      const { create } = loadCanvasBall();
      const paint = (kit: string): string[] => {
        const canvas = new HTMLCanvasElement();
        create(canvas, { kitGlasses: kit, shape: "blob" }).applyPose(pose(0));
        return canvas.marks;
      };
      expect(paint("specs")).toContain("ellipse");
      expect(paint("specs")).not.toContain("roundRect");
      expect(paint("specs-rect")).toContain("roundRect");
      expect(paint("specs-rect")).not.toContain("ellipse");
      expect(paint("specs-cat")).toContain("bezier");
      expect(paint("specs-cat")).not.toContain("ellipse");
      const sun = paint("specs-sun");
      expect(sun).toContain("ellipse");
      expect(sun).toContain("bridge");
      expect(paint("specs")).toContain("bridge");
    } finally {
      g.HTMLCanvasElement = prev;
    }
  });
});
