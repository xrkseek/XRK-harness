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

interface Draw {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
          closePath: noop,
          fill: noop,
          stroke: noop,
          createRadialGradient: () => ({ addColorStop: noop }),
          drawImage(
            _img: unknown,
            x: number,
            y: number,
            w: number,
            h: number,
          ): void {
            canvas.draws.push({ x, y, w, h });
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
      const front = canvas.draws.at(-1);
      expect(front).toBeDefined();
      expect(front!.w).toBeGreaterThan(40);

      canvas.draws.length = 0;
      ball.applyPose(pose(Math.PI / 5));
      const turned = canvas.draws.at(-1);
      expect(turned).toBeDefined();
      expect(turned!.w).toBeLessThan(front!.w);

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
    expect(cssSrc).toMatch(/\.mount\s*\{[^}]*top:\s*0;/s);
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
      expect(src).toMatch(/isHalo \? -28/);
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
