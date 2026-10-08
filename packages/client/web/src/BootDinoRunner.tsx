/**
 * Chromium offline T-Rex parkour under the HARNESS splash hint.
 * Uses the BSD-licensed Chromium sprite sheet (see assets/NOTICE.chromium-offline.txt).
 * Decorative only — proportions / jump physics follow chrome://dino LDPI units.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import sprite1x from './assets/chromium-offline-sprite-1x.png'
import sprite2x from './assets/chromium-offline-sprite-2x.png'
import css from './BootDinoRunner.module.css'

/** Chromium offline-sprite-definitions (original set), LDPI + HDPI. */
type SpriteDef = {
  cactusSmall: { x: number; y: number }
  cactusLarge: { x: number; y: number }
  cloud: { x: number; y: number }
  horizon: { x: number; y: number }
  trex: { x: number; y: number }
  scale: 1 | 2
}

const LDPI: SpriteDef = {
  cactusSmall: { x: 228, y: 2 },
  cactusLarge: { x: 332, y: 2 },
  cloud: { x: 86, y: 2 },
  horizon: { x: 2, y: 54 },
  trex: { x: 848, y: 2 },
  scale: 1,
}

const HDPI: SpriteDef = {
  cactusSmall: { x: 446, y: 2 },
  cactusLarge: { x: 652, y: 2 },
  cloud: { x: 166, y: 2 },
  horizon: { x: 2, y: 104 },
  trex: { x: 1678, y: 2 },
  scale: 2,
}

/**
 * LDPI playfield slice of Chromium 600×150.
 * Wider than the hint column so run / jump / clear read clearly.
 */
const VIEW_W = 440
const VIEW_H = 150
const BOTTOM_PAD = 10
const TREX_W = 44
const TREX_H = 47
/** Top of standing T-Rex (Chromium: height - trexH - bottomPad). */
const GROUND_Y = VIEW_H - BOTTOM_PAD - TREX_H
/** Feet / obstacle baseline. */
const FEET_Y = VIEW_H - BOTTOM_PAD
const DINO_X = 44
const DINO_NOSE = DINO_X + TREX_W * 0.35
const HORIZON_SRC_W = 600
const HORIZON_H = 12
const HORIZON_Y = FEET_Y - 13
const CLOUD_W = 46
const CLOUD_H = 14

/** Chromium Trex normalJumpConfig + Runner speed (px / 60fps frame). */
const FPS = 60
const GRAVITY = 0.6
const JUMP_VELOCITY = -10
const SPEED = 6
const RUN_MS = 1000 / 12
const RUN_FRAMES = [88, 132] as const
/** Small cactus widths for 1 / 2 plants; large for 1 / 2 (skip 3-wide — hard to clear). */
const SMALL_W = [17, 34] as const
const SMALL_H = 35
const LARGE_W = [25, 50] as const
const LARGE_H = 50

/**
 * Airtime ≈ 37 frames @ speed 6 → ~222px. Gaps must exceed that plus lead
 * so we land before the next takeoff window.
 */
const MIN_GAP = 260
const GAP_JITTER = 80

type Obstacle = {
  id: number
  x: number
  kind: 'small' | 'large'
  size: 0 | 1
}
type Cloud = { x: number; y: number }
type SpriteSource = CanvasImageSource & { width: number; height: number }

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function loadSprite(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('boot dino: sprite failed to load'))
    img.src = url
  })
}

/** LDPI grayscale sheet: punch black → alpha. HDPI already has palette alpha. */
function prepareSprite(img: HTMLImageElement, hidpi: boolean): SpriteSource {
  if (hidpi) return img
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')
  if (g === null) return img
  g.drawImage(img, 0, 0)
  const id = g.getImageData(0, 0, c.width, c.height)
  const d = id.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) d[i + 3] = 0
  }
  g.putImageData(id, 0, 0)
  return c
}

function obstacleWidth(o: Obstacle): number {
  return o.kind === 'small' ? SMALL_W[o.size]! : LARGE_W[o.size]!
}

function obstacleHeight(o: Obstacle): number {
  return o.kind === 'small' ? SMALL_H : LARGE_H
}

/**
 * Lead so the jump arc clears this obstacle (tuned for Chromium boxes).
 * Tall/wide cacti need a slightly later takeoff than short ones.
 */
function jumpLeadFor(o: Obstacle): number {
  const h = obstacleHeight(o)
  const w = obstacleWidth(o)
  if (h >= LARGE_H) return 62 + Math.min(12, w * 0.08)
  return 50 + Math.min(10, w * 0.1)
}

let nextObstacleId = 1

function spawnObstacle(x: number): Obstacle {
  const kind: Obstacle['kind'] = Math.random() < 0.4 ? 'large' : 'small'
  const size: 0 | 1 = Math.random() < 0.55 ? 0 : 1
  return { id: nextObstacleId++, x, kind, size }
}

/** Tiny Chromium-sprite runner strip. */
export function BootDinoRunner(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    let ctx: CanvasRenderingContext2D | null = null
    const prevError = console.error
    console.error = () => {}
    try {
      ctx = canvas.getContext('2d')
    } catch {
      console.error = prevError
      return
    }
    console.error = prevError
    if (ctx === null) return

    const reduce = prefersReducedMotion()
    const wantHidpi = typeof devicePixelRatio === 'number' && devicePixelRatio > 1
    let def: SpriteDef = wantHidpi ? HDPI : LDPI
    const dpr = wantHidpi ? Math.max(2, Math.round(devicePixelRatio)) : 1
    canvas.width = VIEW_W * dpr
    canvas.height = VIEW_H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    let cancelled = false
    let raf = 0
    let sprite: SpriteSource | undefined
    let last = performance.now()
    let horizon = 0
    let runTimer = 0
    let runFrame = 0
    let dinoY = GROUND_Y
    let jumpVelocity = 0
    let jumping = false
    /** Obstacle we already committed a jump for (avoid double takeoff / missed clears). */
    let jumpForId = 0
    const obstacles: Obstacle[] = [
      spawnObstacle(VIEW_W + 80),
      spawnObstacle(VIEW_W + 80 + MIN_GAP + 40),
      spawnObstacle(VIEW_W + 80 + (MIN_GAP + 40) * 2),
    ]
    const clouds: Cloud[] = [
      { x: 120, y: 24 },
      { x: 280, y: 40 },
      { x: 400, y: 28 },
    ]

    /**
     * `origin` is sheet-absolute (LDPI or HDPI table).
     * `lx/ly/lw/lh` are LDPI-logical offsets/sizes; multiplied by sheet scale.
     */
    const drawSprite = (
      origin: { x: number; y: number },
      lx: number,
      ly: number,
      lw: number,
      lh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void => {
      if (sprite === undefined) return
      const s = def.scale
      ctx.drawImage(
        sprite,
        origin.x + lx * s,
        origin.y + ly * s,
        lw * s,
        lh * s,
        Math.round(dx),
        Math.round(dy),
        dw,
        dh,
      )
    }

    const nearestAhead = (): Obstacle | undefined => {
      let best: Obstacle | undefined
      let bestDist = Infinity
      for (const o of obstacles) {
        const dist = o.x - DINO_NOSE
        if (dist > -obstacleWidth(o) && dist < bestDist) {
          bestDist = dist
          best = o
        }
      }
      return best
    }

    const paintStill = (): void => {
      ctx.clearRect(0, 0, VIEW_W, VIEW_H)
      drawSprite(def.horizon, 0, 0, HORIZON_SRC_W, HORIZON_H, 0, HORIZON_Y, HORIZON_SRC_W, HORIZON_H)
      drawSprite(def.trex, 0, 0, TREX_W, TREX_H, DINO_X, GROUND_Y, TREX_W, TREX_H)
    }

    const frame = (now: number): void => {
      if (cancelled) return
      const dtMs = Math.min(50, now - last)
      last = now
      const frames = dtMs / (1000 / FPS)

      horizon = (horizon + SPEED * frames) % HORIZON_SRC_W
      runTimer += dtMs
      if (!jumping && runTimer >= RUN_MS) {
        runTimer %= RUN_MS
        runFrame = runFrame === 0 ? 1 : 0
      }

      for (const cloud of clouds) {
        cloud.x -= SPEED * 0.2 * frames
        if (cloud.x < -CLOUD_W) {
          cloud.x = VIEW_W + 40 + Math.random() * 160
          cloud.y = 18 + Math.random() * 36
        }
      }

      for (const o of obstacles) {
        o.x -= SPEED * frames
      }
      for (const o of obstacles) {
        if (o.x < -100) {
          let maxX = 0
          for (const other of obstacles) {
            if (other !== o) maxX = Math.max(maxX, other.x + obstacleWidth(other))
          }
          const gap = MIN_GAP + Math.random() * GAP_JITTER
          Object.assign(o, spawnObstacle(Math.max(VIEW_W + 40, maxX + gap)))
        }
      }

      if (!jumping) {
        const target = nearestAhead()
        if (target !== undefined && target.id !== jumpForId) {
          const dist = target.x - DINO_NOSE
          const lead = jumpLeadFor(target)
          // First ground frame with obstacle inside lead (and still ahead) → jump.
          // Wider than a thin window so a 1–3 frame hitch cannot skip takeoff.
          if (dist <= lead && dist > 0) {
            jumping = true
            jumpVelocity = JUMP_VELOCITY - SPEED / 10
            jumpForId = target.id
          }
        }
      }

      if (jumping) {
        dinoY += jumpVelocity * frames
        jumpVelocity += GRAVITY * frames
        if (dinoY >= GROUND_Y) {
          dinoY = GROUND_Y
          jumping = false
          jumpVelocity = 0
        }
      }

      const frameX = jumping ? 0 : RUN_FRAMES[runFrame]!

      ctx.clearRect(0, 0, VIEW_W, VIEW_H)
      for (const cloud of clouds) {
        drawSprite(def.cloud, 0, 0, CLOUD_W, CLOUD_H, cloud.x, cloud.y, CLOUD_W, CLOUD_H)
      }
      drawSprite(def.horizon, 0, 0, HORIZON_SRC_W, HORIZON_H, -horizon, HORIZON_Y, HORIZON_SRC_W, HORIZON_H)
      drawSprite(
        def.horizon,
        0,
        0,
        HORIZON_SRC_W,
        HORIZON_H,
        -horizon + HORIZON_SRC_W,
        HORIZON_Y,
        HORIZON_SRC_W,
        HORIZON_H,
      )
      for (const o of obstacles) {
        const w = obstacleWidth(o)
        const h = obstacleHeight(o)
        const src = o.kind === 'small' ? def.cactusSmall : def.cactusLarge
        drawSprite(src, 0, 0, w, h, o.x, FEET_Y - h, w, h)
      }
      drawSprite(def.trex, frameX, 0, TREX_W, TREX_H, DINO_X, dinoY, TREX_W, TREX_H)
      raf = requestAnimationFrame(frame)
    }

    void loadSprite(wantHidpi ? sprite2x : sprite1x)
      .catch(() => loadSprite(sprite1x))
      .then((img) => {
        if (cancelled) return
        const usedHidpi = img.naturalWidth > 1500
        def = usedHidpi ? HDPI : LDPI
        sprite = prepareSprite(img, usedHidpi)
        if (reduce) {
          paintStill()
          return
        }
        last = performance.now()
        raf = requestAnimationFrame(frame)
      })
      .catch(() => {
        /* splash stays without parkour if the asset is missing */
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className={css.track} aria-hidden data-testid="boot-dino-runner">
      <canvas ref={canvasRef} className={css.canvas} width={VIEW_W} height={VIEW_H} />
    </div>
  )
}
