/* ============================================================
 * canvas-ball.js —— OffscreenCanvas / Canvas2D render path
 *
 * Same EmotionBall.createBall contract as ball.js (SVG), but paints
 * into a Canvas so a Worker can own the frame loop. Body + eyes +
 * optional dressing bitmaps; ribbons/confetti/zzz are no-ops in lite
 * and omitted on this path (engine still drives breathe / blink / gaze).
 * ============================================================ */
(function () {
  'use strict';

  var EB = (globalThis.EmotionBall = globalThis.EmotionBall || {});
  var RD = globalThis.EB_RINGS;
  var EXPR = RD.EXPRESSIONS;
  var HEAD_C = RD.HEAD_C;
  var EYE_HALF = RD.EYE_HALF;
  /* Match ball.js viewBox (-15 -100 259 344): top pad for bounce + halo. */
  var VIEW_W = 259;
  var VIEW_H = 344;
  var ORIGIN_X = -15;
  var ORIGIN_Y = -100;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function shade(hex, amt) {
    var h = String(hex || '#888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return hex;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var target = amt < 0 ? 0 : 255;
    var a = Math.abs(amt);
    r = Math.round(r + (target - r) * a);
    g = Math.round(g + (target - g) * a);
    b = Math.round(b + (target - b) * a);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /* ---- 装扮配色：与 ball.js kitPalette 同源的 HSL 派生 ----
   * 每套帽子/眼镜的部件色都由体色相位算出来，57 种体色都能自动协调。 */

  /**
   * 帽款固有色，与 ball.js 的 HAT_PALETTES 逐项一致。
   *
   * 只用体色相位派生时，18 款帽子在同一颗球上是同一种土黄 —— 换轮廓不换色，
   * 一眼就看出"都一个色儿"。这里给每款按实物取色；体色相位退化成兜底
   * （镜框、缝线这类确实该跟衣服协调的部件仍走它）。
   */
  var HAT_PALETTES = {
    bow: { bow: '#F08AA6', knot: '#D96D8B', accent: '#F8C0CF' },
    cap: { crown: '#33507A', brim: '#22395C', accent: '#EFE3C8', seam: '#8FA6C4' },
    beanie: { crown: '#B8433A', brim: '#8F2F29', accent: '#F0D9B5', seam: '#E8A79E' },
    bucket: { crown: '#7D8A63', brim: '#5F6B4A', accent: '#E7DCC0' },
    beret: { crown: '#8E3446', brim: '#6B2434', accent: '#D98A98' },
    visor: { brim: '#2B7E8E', accent: '#3FA3B4' },
    halo: { halo: '#F2CE6B' },
    crown: { crown: '#E8C050', brim: '#C08F22', accent: '#FFF3C0' },
    tophat: { crown: '#24202A', brim: '#141118', accent: '#C9A227' },
    chef: { crown: '#FBFAF7', brim: '#E6E2DA', accent: '#D8D0C4' },
    party: { crown: '#7A5BC8', brim: '#5E42A0', accent: '#F2C14E' },
    straw: { crown: '#D9BC73', brim: '#E4CB88', accent: '#B5462F' },
    wizard: { crown: '#4B3A8C', brim: '#3D2E73', accent: '#F2C14E' },
    'cat-ears': { crown: '#3B3B45', brim: '#26262E', accent: '#F4A0B4' },
    headphones: { frame: '#5A5E6A', brim: '#1A1A20', accent: '#3A3A44' },
    antenna: { frame: '#8A94A6', brim: '#5E6675', accent: '#E8C46A', crown: '#FBF0C8' },
    'flower-crown': { crown: '#4E7A42', brim: '#3A5C31', accent: '#F2A0C0', knot: '#F2C14E' },
    cake: { accent: '#F2A03C' },
  };

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var d = max - min;
    if (d < 1e-6) return [0, 0, l];
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return [h, s, l];
  }
  function hslc(h, s, l, a) {
    var hue = ((h % 360) + 360) % 360;
    var sat = Math.round(clamp(s, 0, 1) * 100);
    var lig = Math.round(clamp(l, 0, 1) * 100);
    return a === undefined
      ? 'hsl(' + hue.toFixed(0) + ', ' + sat + '%, ' + lig + '%)'
      : 'hsla(' + hue.toFixed(0) + ', ' + sat + '%, ' + lig + '%, ' + a + ')';
  }
  function kitPaletteOf(body, hatKind) {
    var hex = String(body || '#F3F0EA').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    if (!isFinite(n)) n = 0xf3f0ea;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    var hs = rgbToHsl(r, g, b);
    var pal;
    if (L < 0.32) {
      pal = {
        frame: shade(body, 0.62),
        lens: 'rgba(255,255,255,0.16)',
        lensSun: shade(body, 0.1),
        brim: shade(body, 0.28),
        crown: shade(body, 0.16),
        accent: '#E8C46A',
        bow: '#E8A0B4',
        knot: '#F0C8D4',
        halo: '#F0D78A',
      };
    } else {
      pal = {
        frame: hslc(hs[0], hs[1] * 0.55, 0.16),
        lens: hslc(hs[0], hs[1] + 0.12, 0.62, 0.14),
        lensSun: hslc(hs[0], hs[1] + 0.16, 0.2, 0.58),
        brim: hslc(hs[0], hs[1] * 0.7, hs[2] * 0.34),
        crown: hslc(hs[0], hs[1] * 0.95, hs[2] * 0.6),
        accent: hslc(hs[0] + 38, hs[1] + 0.22, hs[2] * 0.78),
        bow: hslc(hs[0] - 28, hs[1] + 0.2, hs[2] * 0.92),
        knot: hslc(hs[0] - 28, hs[1] + 0.24, hs[2] * 0.68),
        halo: hslc(hs[0] + 46, 0.62, 0.72),
      };
    }
    /* 缝线默认跟镜框；帽款在 HAT_PALETTES 里给了 seam 就用自己的。 */
    pal.seam = pal.frame;
    var hat = hatKind ? HAT_PALETTES[hatKind] : null;
    if (hat) {
      for (var key in hat) {
        if (Object.prototype.hasOwnProperty.call(hat, key)) pal[key] = hat[key];
      }
    }
    return pal;
  }
  /* 与 ball.js HAT_Y_OFF / HAT_SCALE 逐项对应；缺项回落。 */
  var HAT_Y_OFF = {
    halo: -28, antenna: -2, wizard: 0, tophat: 0, party: 1, crown: 1, cake: 1, chef: 1,
    bow: -4, 'flower-crown': 1, 'cat-ears': 1, straw: 0, beanie: 0, headphones: 0,
    cap: 2, visor: -4,
  };
  var HAT_SCALE = {
    cake: 1.4, party: 1.3, antenna: 1.3, crown: 1.25, 'flower-crown': 1.2, chef: 1.2,
    'cat-ears': 1.15, tophat: 1.1, wizard: 1.1, headphones: 1.06,
    bucket: 1.02, beret: 1.06,
  };
  function centroid(ring) {
    var x = 0, y = 0;
    for (var i = 0; i < ring.length; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / ring.length, y / ring.length];
  }
  function ringToPath(ctx, ring) {
    if (!ring || !ring.length) return;
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (var i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
    ctx.closePath();
  }

  function createBall(container, opts) {
    opts = opts || {};
    var lite = !!opts.lite;
    var shape = RD.SHAPES[opts.shape] || RD.SHAPES.blob;
    var face = shape.face;
    var headRing = shape.ring;

    var silMinY = 1e9, silMaxY = -1e9;
    var i;
    for (i = 0; i < headRing.length; i++) {
      if (headRing[i][1] < silMinY) silMinY = headRing[i][1];
      if (headRing[i][1] > silMaxY) silMaxY = headRing[i][1];
    }
    var SIL_STEP = 2;
    var silRows = [];
    (function buildSil() {
      var rows = Math.ceil((silMaxY - silMinY) / SIL_STEP) + 1;
      for (var r = 0; r < rows; r++) {
        var y = silMinY + r * SIL_STEP;
        var lo = 1e9, hi = -1e9;
        for (var e = 0; e < headRing.length; e++) {
          var a = headRing[e], b = headRing[(e + 1) % headRing.length];
          var y0 = a[1], y1 = b[1];
          if ((y0 <= y && y1 >= y) || (y1 <= y && y0 >= y)) {
            var t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
            var x = a[0] + (b[0] - a[0]) * t;
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          }
        }
        if (lo > hi) { lo = HEAD_C - 4; hi = HEAD_C + 4; }
        silRows.push([lo, hi]);
      }
    })();
    function silAt(y) {
      var r = Math.round((clamp(y, silMinY, silMaxY) - silMinY) / SIL_STEP);
      return silRows[clamp(r, 0, silRows.length - 1)];
    }

    var canvas = null;
    var ctx = null;
    var cssW = opts.cssW || 0;
    var cssH = opts.cssH || 0;
    var dpr = opts.dpr || 1;
    var bodyColor = opts.color || '#E8A87C';
    var eyeColor = opts.eyeColor || '#1A1A1A';
    var BASE_C = [centroid(EXPR[0][0]), centroid(EXPR[0][1])];
    var eyeL = { ring: EXPR[0][0], c: BASE_C[0], slot: null };
    var eyeR = { ring: EXPR[0][1], c: BASE_C[1], slot: null };
    var lastPose = null;
    var hatImg = null;
    var glassesImg = null;
    var heldImg = null;
    function splitLegacyKit(kind) {
      if (!kind || kind === 'none') return { hat: 'none', glasses: 'none' };
      if (String(kind).indexOf('specs') === 0) return { hat: 'none', glasses: kind };
      return { hat: kind, glasses: 'none' };
    }
    var split0 = splitLegacyKit(opts.kit);
    var kitHat = opts.kitHat || split0.hat || 'none';
    var kitGlasses = opts.kitGlasses || split0.glasses || 'none';
    var kitHeld = opts.kitHeld || 'none';
    function isBitmap(v) {
      return typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;
    }
    var hatImage = (typeof opts.hatImage === 'string' || isBitmap(opts.hatImage))
      ? opts.hatImage
      : '';
    var glassesImage = (typeof opts.glassesImage === 'string' || isBitmap(opts.glassesImage))
      ? opts.glassesImage
      : '';
    var heldImage = (typeof opts.heldImage === 'string' || isBitmap(opts.heldImage))
      ? opts.heldImage
      : '';

    var isOffscreen = typeof OffscreenCanvas !== 'undefined'
      && container instanceof OffscreenCanvas;
    var isCanvas = typeof HTMLCanvasElement !== 'undefined'
      && container instanceof HTMLCanvasElement;

    if (isOffscreen || isCanvas) {
      canvas = container;
      if (!cssW) cssW = canvas.width / dpr || VIEW_W;
      if (!cssH) cssH = canvas.height / dpr || VIEW_H;
    } else if (container && container.appendChild) {
      canvas = (typeof document !== 'undefined')
        ? document.createElement('canvas')
        : null;
      if (!canvas) throw new Error('canvas-ball: no canvas host');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', opts.label || 'AI 表情小球');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.replaceChildren(canvas);
      var rect = container.getBoundingClientRect
        ? container.getBoundingClientRect()
        : { width: VIEW_W, height: VIEW_H };
      dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0)
        ? devicePixelRatio
        : 1;
      cssW = Math.max(1, rect.width || VIEW_W);
      cssH = Math.max(1, rect.height || VIEW_H);
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
    } else {
      throw new Error('canvas-ball: unsupported container');
    }
    ctx = canvas.getContext('2d');

    function resize(nextCssW, nextCssH, nextDpr) {
      cssW = Math.max(1, nextCssW || cssW);
      cssH = Math.max(1, nextCssH || cssH);
      dpr = nextDpr > 0 ? nextDpr : dpr;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      if (lastPose) applyPose(lastPose);
    }

    function loadBitmap(url, slot) {
      if (!url) {
        if (slot === 'hat') hatImg = null;
        if (slot === 'glasses') glassesImg = null;
        if (slot === 'held') heldImg = null;
        if (lastPose) applyPose(lastPose);
        return;
      }
      var done = function (bmp) {
        if (slot === 'hat') hatImg = bmp;
        if (slot === 'glasses') glassesImg = bmp;
        if (slot === 'held') heldImg = bmp;
        if (lastPose) applyPose(lastPose);
      };
      /* Host may transfer a main-thread-decoded ImageBitmap (SVG-safe). */
      if (isBitmap(url)) {
        done(url);
        return;
      }
      if (typeof createImageBitmap === 'function') {
        fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
          return createImageBitmap(b);
        }).then(done).catch(function () { /* keep prior frame */ });
        return;
      }
      if (typeof Image !== 'undefined') {
        var img = new Image();
        img.onload = function () { done(img); };
        img.src = url;
      }
    }

    loadBitmap(hatImage, 'hat');
    loadBitmap(glassesImage, 'glasses');
    loadBitmap(heldImage, 'held');

    function eyeSlot(eye, pose, k, yaw) {
      var ring = pose.ring;
      if (ring && ring !== eye.ring) {
        eye.ring = ring;
        eye.c = centroid(ring);
      }
      var base = eye.c || BASE_C[k];
      var open = clamp(pose.open, 0.02, 2.4);
      var sy = clamp(pose.scaleY * open * face.eye, 0.02, 2.4);
      var sxBase = pose.scaleX * face.eye;
      var halfH = EYE_HALF * sy + 2;
      var ey0 = HEAD_C + face.y + (base[1] - HEAD_C) * face.sy + pose.y + pose.lookY;
      ey0 = clamp(ey0, silMinY + halfH, silMaxY - halfH);
      var sil = silAt(ey0);
      var cx0 = (sil[0] + sil[1]) / 2;
      var hw = Math.max((sil[1] - sil[0]) / 2, 12);
      var ox = face.x + (base[0] - HEAD_C) * face.sx + pose.x + pose.lookX;
      var theta = clamp(ox / hw, -1.15, 1.15);
      var total = theta + (yaw || 0);
      var cn = Math.cos(total);
      if (cn <= 0.02) {
        eye.slot = null;
        return;
      }
      var ex = cx0 + hw * Math.sin(total) * 0.985;
      var dyN = (ey0 - HEAD_C) / 130;
      var fy = Math.sqrt(1 - dyN * dyN * 0.22);
      eye.slot = {
        x: ex,
        y: ey0,
        sx: sxBase * cn,
        sy: sy * fy,
        rotate: pose.rotate || 0,
        base: base,
        ring: eye.ring,
        color: pose.color || eyeColor,
        sketch: false,
      };
    }

    function drawEye(eye) {
      var s = eye.slot;
      if (!s || !s.ring) return;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.rotate) ctx.rotate(s.rotate * Math.PI / 180);
      ctx.scale(s.sx, s.sy);
      ctx.translate(-s.base[0], -s.base[1]);
      ctx.beginPath();
      ringToPath(ctx, s.ring);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
    }

    /** 贴纸眼镜按「半幅 ↔ 单眼」映射：左片跟左眼、右片跟右眼。
     *  整图铺满两眼中间只会让镜片在转头时离开眼球（老板报的原生差异）。 */
    function drawGlassesSticker(img) {
      var L = eyeL.slot;
      var R = eyeR.slot;
      if (!L && !R) return;
      var iw = img.width || 96;
      var ih = img.height || 32;
      var half = iw / 2;
      var draw = function (slot, other, side) {
        if (!slot || Math.abs(slot.sx || 0) < 0.08) return;
        var sz = lensRadii(slot, other);
        var rx = sz.rx * 1.38;
        var ry = sz.ry * 1.38;
        ctx.drawImage(
          img,
          side < 0 ? 0 : half, 0, half, ih,
          slot.x - rx, slot.y - ry * 0.88, rx * 2, ry * 1.76,
        );
      };
      draw(L, R, -1);
      draw(R, L, 1);
    }

    function drawDressing(img, slot) {
      if (!img) return;
      var L = eyeL.slot;
      var R = eyeR.slot;
      var cx = HEAD_C;
      var cy = HEAD_C;
      var w = 48;
      var h = 48;
      if (slot === 'glasses') {
        drawGlassesSticker(img);
        return;
      } else if (slot === 'hat') {
        /* 与 SVG 同锚：名义 64×64 框中心压在 silMinY+2，按头部半宽缩放。 */
        var bandH = silAt(Math.min(silMaxY - 4, Math.max(silMinY + 6, silMinY + 16)));
        var hwH = Math.max((bandH[1] - bandH[0]) / 2, 14);
        var fitH = (hwH * 2) / 54;
        cx = (bandH[0] + bandH[1]) / 2;
        cy = silMinY + 2;
        w = 64 * fitH;
        h = 64 * fitH;
      } else if (slot === 'held' && R) {
        cx = R.x + 36;
        cy = R.y + 28;
        w = 36;
        h = 36;
      }
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    }

    function kitFill(d, color) {
      if (typeof Path2D !== 'function') return;
      try {
        ctx.fillStyle = color;
        ctx.fill(new Path2D(d));
      } catch (_e) { /* Worker/canvas without path fill */ }
    }

    /* 装扮小工具：圆 / 椭圆 / 圆角矩形。帽子与手持共用。 */
    function spot(px, py, r, color) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    function oval(px, py, rx, ry, color) {
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    function box(px, py, w, h, r, color) {
      ctx.fillStyle = color;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(px, py, w, h, r);
        ctx.fill();
      } else {
        ctx.fillRect(px, py, w, h);
      }
    }

    function drawBuiltInHat(yaw) {
      if (hatImg) {
        drawDressing(hatImg, 'hat');
        return;
      }
      if (!kitHat || kitHat === 'none') return;
      var cn = Math.cos(yaw || 0);
      var isHalo = kitHat === 'halo';
      /* Halo stays through spin/bounce; solid hats hide only behind the head. */
      if (!isHalo && cn <= -0.12) return;
      var yOff = HAT_Y_OFF[kitHat] !== undefined ? HAT_Y_OFF[kitHat] : 0;
      var y = silMinY + yOff;
      var sampleY = Math.min(silMaxY - 4, Math.max(silMinY + 6, y + 14));
      var band = silAt(sampleY);
      var hw = Math.max((band[1] - band[0]) / 2, 14);
      var cx = (band[0] + band[1]) / 2;
      var x = cx + hw * Math.sin(yaw || 0) * (isHalo ? 0.22 : 0.74);
      var cnAbs = Math.abs(cn);
      var sx = isHalo ? (0.55 + 0.45 * cnAbs) : (0.45 + 0.55 * Math.max(cn, 0));
      var boost = HAT_SCALE[kitHat] || 1;
      /* 与 SVG 路径同规格：按整条弦宽 2·hw 归一化（旧式 hw/54 只有头宽 1/4）。 */
      var fit = (hw * 2) / 54 * boost;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(fit * sx, fit);
      if (isHalo) ctx.rotate(-8 * Math.PI / 180);
      var pal = kitPaletteOf(bodyColor, kitHat);
      var crown = pal.crown;
      var brim = pal.brim;
      var accent = pal.accent;
      if (kitHat === 'bow') {
        kitFill('M-22-2c0-7 7-12 13-8 4 3 6 7 9 10 3-3 5-7 9-10 6-4 13 1 13 8 0 5-4 8-9 8-4 0-7-2-10-5-3 3-6 5-10 5-5 0-9-3-9-8z', pal.bow);
        spot(0, 1, 4.4, pal.knot);
      } else if (kitHat === 'cap') {
        /* 真鸭舌：硬顶 + 前探的舌头 + 顶扣（与 ball.js 同形）。 */
        kitFill('M-20.5 8.4C-20.5-10.6-11.4-19.6 0-19.6S20.5-10.6 20.5 8.4C13 5 7 3.4 0 3.4S-13 5-20.5 8.4Z', crown);
        kitFill('M-24.6 8.6C-19.4 16.4-10.8 20.6 0 20.6S19.4 16.4 24.6 8.6C16.4 12.4 8.2 14.1 0 14.1S-16.4 12.4-24.6 8.6Z', brim);
        ctx.strokeStyle = 'rgba(255,255,255,0.32)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-19, 10.8);
        ctx.quadraticCurveTo(-8, 19, 0, 19.2);
        ctx.stroke();
        ctx.strokeStyle = pal.frame;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-12.6, 5.6);
        ctx.quadraticCurveTo(-10, -6, 0, -9.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
        spot(0, -19.2, 2.9, accent);
      } else if (kitHat === 'beanie') {
        kitFill('M-20.6 11.4C-20.6-7.6-11.4-18.4 0-18.4S20.6-7.6 20.6 11.4Z', crown);
        box(-22.6, 6.4, 45.2, 10.8, 5.2, brim);
        ctx.strokeStyle = pal.seam || brim;
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-14.4, 7.2); ctx.lineTo(-14.4, 16.6);
        ctx.moveTo(-7.2, 6.8); ctx.lineTo(-7.2, 17);
        ctx.moveTo(0, 6.6); ctx.lineTo(0, 17.2);
        ctx.moveTo(7.2, 6.8); ctx.lineTo(7.2, 17);
        ctx.moveTo(14.4, 7.2); ctx.lineTo(14.4, 16.6);
        ctx.stroke();
        spot(0, -19.8, 4.4, accent);
      } else if (kitHat === 'bucket') {
        kitFill('M-18.4 3.6C-18.4-9.4-9.4-17.2 0-17.2S18.4-9.4 18.4 3.6Z', crown);
        box(-18.4, 0.4, 36.8, 5.4, 2.4, accent);
        kitFill('M-27.4 3.2C-25 12.6-14.6 18.2 0 18.2S25 12.6 27.4 3.2C20.6 8.2 10.8 11.2 0 11.2S-20.6 8.2-27.4 3.2Z', brim);
        ctx.strokeStyle = 'rgba(255,255,255,0.26)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-24.6, 6.4);
        ctx.quadraticCurveTo(-10, 17, 0, 16.8);
        ctx.stroke();
      } else if (kitHat === 'beret') {
        ctx.save();
        ctx.translate(1, -3.8);
        ctx.rotate(-9 * Math.PI / 180);
        oval(0, 0, 23.4, 12.8, crown);
        ctx.restore();
        ctx.strokeStyle = brim;
        ctx.lineWidth = 4.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-20.4, 2.2);
        ctx.quadraticCurveTo(-2, 9.2, 21.2, 0.4);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-12, -9.8);
        ctx.quadraticCurveTo(0, -15, 13, -10.8);
        ctx.stroke();
        spot(13.2, -14.8, 3.2, accent);
      } else if (kitHat === 'visor') {
        box(-22, 2, 44, 6, 2.4, accent);
        oval(0, 12, 32, 7, brim);
      } else if (kitHat === 'halo') {
        ctx.strokeStyle = pal.halo;
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.ellipse(0, 0, 36, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = pal.halo;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(-8, -2, 11, 3.2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (kitHat === 'crown') {
        kitFill('M-22 12 L-22-10 L-11 1 L0-15 L11 1 L22-10 L22 12 Z', crown);
        box(-23, 8, 46, 7, 2.4, brim);
        spot(0, -15, 2.8, accent);
        spot(-22, -10, 2.4, accent);
        spot(22, -10, 2.4, accent);
      } else if (kitHat === 'tophat') {
        oval(0, 10, 28, 5.6, brim);
        box(-16, -32, 32, 42, 3, crown);
        box(-16, -1, 32, 7, 0, accent);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(-5, -27, 4, 20);
      } else if (kitHat === 'chef') {
        box(-16, 2, 32, 12, 3, brim);
        spot(-13, -8, 10, crown);
        spot(13, -8, 10, crown);
        spot(0, -15, 12, crown);
        box(-16, 7, 32, 4, 2, accent);
      } else if (kitHat === 'party') {
        kitFill('M0-32 L15 10 L-15 10 Z', crown);
        kitFill('M-7.6-11 L7.6-11 L9.4-4 L-9.4-4 Z', accent);
        oval(0, 10, 15, 3.4, brim);
        spot(0, -33, 4, accent);
      } else if (kitHat === 'straw') {
        oval(0, 8, 32, 7, brim);
        kitFill('M-18 8c0-14 8-22 18-22s18 8 18 22z', crown);
        box(-18, -1, 36, 5, 1.6, accent);
      } else if (kitHat === 'wizard') {
        oval(0, 8, 26, 5.6, brim);
        kitFill('M-13 8 C-10-8 -2-24 9-33 C4-21 8-7 13 8 Z', crown);
        kitFill('M1-17 l2.2 4.3 4.7 .7 -3.4 3.2 .8 4.7 -4.3-2.3 -4.3 2.3 .8-4.7 -3.4-3.2 4.7-.7z', accent);
      } else if (kitHat === 'cat-ears') {
        kitFill('M-23 8 L-18-17 L-4-3 Z', crown);
        kitFill('M23 8 L18-17 L4-3 Z', crown);
        box(-21, 2, 42, 7, 3, brim);
        kitFill('M-17.6-7 L-15.4-1 L-9.6-1 Z', accent);
        kitFill('M17.6-7 L15.4-1 L9.6-1 Z', accent);
      } else if (kitHat === 'headphones') {
        ctx.strokeStyle = pal.frame;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 4, 25, Math.PI, 0);
        ctx.stroke();
        box(-29, -8, 11, 20, 5, accent);
        box(18, -8, 11, 20, 5, accent);
        box(-27.4, -5, 7.8, 14, 3.6, brim);
        box(19.6, -5, 7.8, 14, 3.6, brim);
      } else if (kitHat === 'antenna') {
        ctx.strokeStyle = pal.frame;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(0, -19);
        ctx.stroke();
        spot(0, -23, 5.6, accent);
        spot(-1.8, -25, 1.7, crown);
        box(-8, 0, 16, 5, 2.5, brim);
      } else if (kitHat === 'flower-crown') {
        var wreath = [[-19, 3], [-10, -5], [0, -8], [10, -5], [19, 3]];
        ctx.strokeStyle = crown;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-22, 6);
        ctx.quadraticCurveTo(0, -10, 22, 6);
        ctx.stroke();
        for (var wi = 0; wi < wreath.length; wi++) {
          spot(wreath[wi][0], wreath[wi][1], 4.6, accent);
          spot(wreath[wi][0], wreath[wi][1], 1.7, pal.knot);
        }
      } else if (kitHat === 'cake') {
        box(-19, -4, 38, 16, 3.2, '#FBF6EC');
        kitFill('M-19-2 c3 4.6 6.6-2.6 9.5 0 s6.6 4.6 9.5 0 s6.6-4.6 9.5 0 s6.6 4.6 9.5 0 v-4.5 h-38 z', '#FFFBF3');
        kitFill('M-19 10 c3 4.4 6.6-4.4 9.5 0 s6.6 4.4 9.5 0 s6.6-4.4 9.5 0 s6.6 4.4 9.5 0 v2.6 h-38 z', '#FFFBF3');
        box(-1.7, -29, 3.4, 25, 1.4, '#F2E6D2');
        kitFill('M0-37 c4.6 5.4 5.6 8.4 0 11.4 c-5.6-3-4.6-6 0-11.4 z', accent);
        spot(-11, 4, 2.2, '#E07090');
        spot(0, 6, 2.2, '#E8C46A');
        spot(11, 4, 2.2, '#7ABAA8');
      }
      ctx.restore();
    }

    /* Same unit path as ball.js CAT_LENS — scaled per eye so cat-eye stays distinct. */
    function traceCatLens(side, rx, ry) {
      ctx.save();
      ctx.scale(side < 0 ? -rx : rx, ry);
      ctx.moveTo(-1, 0);
      ctx.bezierCurveTo(-1, -0.82, -0.2, -1.02, 0.12, -0.7);
      ctx.bezierCurveTo(0.82, -1.18, 1.18, -0.18, 1, 0.12);
      ctx.bezierCurveTo(0.5, 0.82, -0.55, 0.68, -1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.18;
      ctx.stroke();
      ctx.restore();
    }

    function lensRadii(slot, other) {
      var rx = Math.max(Math.abs(EYE_HALF * (slot.sx || 0)) * 0.72, 6) * 1.42;
      var ry = Math.max(Math.abs(EYE_HALF * (slot.sy || 0)) * 0.72, 5) * 1.42 * 0.9;
      if (other) {
        var gap = Math.abs((other.x || 0) - (slot.x || 0));
        var maxRx = Math.max(8, (gap - 10) * 0.5);
        if (rx > maxRx) rx = maxRx;
      }
      return { rx: rx, ry: Math.min(ry, rx * 0.92) };
    }

    function drawBuiltInGlasses() {
      if (glassesImg) {
        drawDressing(glassesImg, 'glasses');
        return;
      }
      if (String(kitGlasses).indexOf('specs') !== 0) return;
      var shape = kitGlasses === 'specs-rect' ? 'rect'
        : (kitGlasses === 'specs-cat' ? 'cat'
          : (kitGlasses === 'specs-round-xl' ? 'round-xl'
            : (kitGlasses === 'specs-oval' ? 'oval'
              : (kitGlasses === 'specs-square' ? 'square'
                : (kitGlasses === 'specs-half' ? 'half'
                  : (kitGlasses === 'specs-rimless' ? 'rimless'
                    : (kitGlasses === 'specs-monocle' ? 'monocle'
                      : (kitGlasses === 'specs-heart' ? 'heart'
                        : (kitGlasses === 'specs-shades' ? 'shades' : 'round')))))))));
      var sun = shape === 'aviator' || shape === 'shades';
      var pal = kitPaletteOf(bodyColor);
      var fill = sun ? pal.lensSun : pal.lens;
      var stroke = pal.frame;
      /* 特色框：金属丝 / 金单片 / 霓虹赛博不走体色相位，跟 SVG 路径一致。 */
      if (shape === 'round-metal') stroke = '#5E646E';
      if (shape === 'monocle') stroke = '#C8A24A';
      if (shape === 'aviator') stroke = '#8A8F98';
      if (shape === 'cyber') { stroke = '#5AE0FF'; fill = 'rgba(28,240,255,0.2)'; }
      var L = eyeL.slot;
      var R = eyeR.slot;
      var boost = {
        'sport': [1.2, 1.14], wayfarer: [1.1, 0.9], cat: [1.12, 1],
        aviator: [1.06, 1.18], oval: [1.16, 0.72], square: [1.02, 0.98],
        half: [1.06, 1.02], rimless: [1.04, 1.04], monocle: [1.1, 1.1],
        cyber: [1.08, 0.94], shades: [1, 1], 'round-metal': [1.04, 1.04],
      }[shape];
      function lens(slot, other, side) {
        if (!slot || Math.abs(slot.sx || 0) < 0.08) return null;
        if (shape === 'monocle' && side < 0) return null;
        var sz = lensRadii(slot, other);
        if (boost) sz = { rx: sz.rx * boost[0], ry: sz.ry * boost[1] };
        if (shape === 'shades' || shape === 'sport') sz = { rx: sz.rx + 5, ry: sz.ry };
        ctx.save();
        ctx.translate(slot.x, slot.y);
        if (slot.rotate) ctx.rotate(slot.rotate * Math.PI / 180);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = shape === 'rimless' ? 0 : (shape === 'round-metal' ? 2.2 : 3.2);
        ctx.beginPath();
        if (shape === 'aviator' || shape === 'cyber') {
          /* 单位框 path：aviator 上沿平、下沿泪滴；cyber 切角矩形。 */
          var unit = shape === 'aviator'
            ? 'M-1,-0.68 L1,-0.68 C1,0.34 0.62,1 -0.01,1 C-0.64,1 -1,0.34 -1,-0.68 Z'
            : 'M-0.84,-0.9 L0.84,-0.9 L1,0.08 L0.66,0.9 L-0.66,0.9 L-1,0.08 Z';
          ctx.scale(sz.rx, sz.ry);
          kitFill(unit, fill);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 0.18;
          ctx.lineJoin = 'round';
          try { ctx.stroke(new Path2D(unit)); } catch (_e) { /* no Path2D */ }
        } else if (shape === 'wayfarer') {
          var wh = sz.ry * 1.8;
          if (typeof ctx.roundRect === 'function') ctx.roundRect(-sz.rx, -wh / 2, sz.rx * 2, wh, Math.min(8, sz.rx * 0.34));
          else ctx.rect(-sz.rx, -wh / 2, sz.rx * 2, wh);
          ctx.fill();
          ctx.lineWidth = 4.4;
          ctx.stroke();
        } else if (shape === 'rect' || shape === 'square') {
          var rh = sz.ry * (shape === 'square' ? 1.8 : 1.7);
          var rad = Math.min(shape === 'square' ? 3 : 7, sz.rx * 0.28);
          if (typeof ctx.roundRect === 'function') ctx.roundRect(-sz.rx, -rh / 2, sz.rx * 2, rh, rad);
          else ctx.rect(-sz.rx, -rh / 2, sz.rx * 2, rh);
          ctx.fill();
          if (shape !== 'rimless') ctx.stroke();
        } else if (shape === 'shades') {
          var sh = sz.ry * 1.52;
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(-sz.rx, -sh / 2, sz.rx * 2, sh, Math.min(6, sz.rx * 0.3));
          } else {
            ctx.rect(-sz.rx, -sh / 2, sz.rx * 2, sh);
          }
          ctx.fill();
          ctx.stroke();
        } else if (shape === 'cat') {
          traceCatLens(side, sz.rx, sz.ry);
        } else if (shape === 'half') {
          ctx.ellipse(0, 0, sz.rx, sz.ry, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (shape === 'heart') {
          ctx.moveTo(0, sz.ry * 0.92);
          ctx.bezierCurveTo(-sz.rx * 1.12, sz.ry * 0.12, -sz.rx * 1.06, -sz.ry * 0.78, -sz.rx * 0.4, -sz.ry * 0.78);
          ctx.bezierCurveTo(-sz.rx * 0.12, -sz.ry * 0.78, 0, -sz.ry * 0.54, 0, -sz.ry * 0.44);
          ctx.bezierCurveTo(0, -sz.ry * 0.54, sz.rx * 0.12, -sz.ry * 0.78, sz.rx * 0.4, -sz.ry * 0.78);
          ctx.bezierCurveTo(sz.rx * 1.06, -sz.ry * 0.78, sz.rx * 1.12, sz.ry * 0.12, 0, sz.ry * 0.92);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (shape === 'rimless') {
          ctx.ellipse(0, 0, sz.rx, sz.ry, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.ellipse(0, 0, sz.rx, sz.ry * (sun ? 0.86 : 1), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
        return sz;
      }
      var lsz = lens(L, R, -1);
      var rsz = lens(R, L, 1);
      if (lsz && rsz && shape !== 'cat' && shape !== 'shades') {
        var lx = L.x + lsz.rx * 0.96;
        var rx = R.x - rsz.rx * 0.96;
        if (rx - lx >= 2) {
          ctx.beginPath();
          ctx.moveTo(lx, L.y);
          ctx.quadraticCurveTo((lx + rx) / 2, (L.y + R.y) / 2 - 4, rx, R.y);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 3.2;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
      if (shape === 'monocle' && R && rsz) {
        /* 单片眼镜的小链子：从镜片右下角垂下来 */
        ctx.beginPath();
        ctx.moveTo(R.x + rsz.rx * 0.8, R.y + rsz.ry * 0.5);
        ctx.quadraticCurveTo(R.x + rsz.rx * 1.5, R.y + rsz.ry * 2.4, R.x + rsz.rx * 0.6, R.y + rsz.ry * 3.2);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    function drawBuiltInHeld(yaw) {
      if (heldImg) {
        drawDressing(heldImg, 'held');
        return;
      }
      if (!kitHeld || kitHeld === 'none') return;
      var y = silMinY + (silMaxY - silMinY) * 0.78;
      var band = silAt(y);
      var hw = Math.max((band[1] - band[0]) / 2, 14);
      var cx = (band[0] + band[1]) / 2;
      var x = cx + hw * (0.62 + Math.sin(yaw || 0) * 0.18);
      var fit = hw / 42;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(fit, fit);
      var brandBadges = (globalThis.EB_RINGS && globalThis.EB_RINGS.BRANDS) || {};
      var badge = brandBadges[kitHeld];
      if (badge) {
        ctx.strokeStyle = badge.color;
        ctx.lineWidth = 3.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 8);
        ctx.lineTo(0, 16);
        ctx.stroke();
        box(-15, -21, 30, 30, 8.4, badge.color);
        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.lineWidth = 1.4;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(-15, -21, 30, 30, 8.4);
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(-12, -18);
        kitFill(badge.path, badge.glyphColor || '#FFFFFF');
        if (badge.accent) kitFill(badge.accent, badge.accentColor || badge.glyphColor || '#FFFFFF');
        ctx.restore();
        ctx.restore();
        return;
      }
      if (kitHeld === 'flower') {
        var petals = [[0, -8], [-7.5, -3], [7.5, -3], [-4.5, 5], [4.5, 5]];
        for (var i = 0; i < petals.length; i++) {
          ctx.beginPath();
          ctx.arc(petals[i][0], petals[i][1], 5.2, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? '#F4A0B4' : '#E07090';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#E8C46A';
        ctx.fill();
      } else if (kitHeld === 'spark') {
        kitFill('M0-16 3.4-3.2 16-2 6.4 6.2 9.2 18 0 11.2-9.2 18-6.4 6.2-16-2-3.4-3.2Z', '#E8C46A');
      } else if (kitHeld === 'flag') {
        ctx.strokeStyle = '#5A6068';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-10, -16);
        ctx.lineTo(-10, 16);
        ctx.stroke();
        kitFill('M-9-15 l22 8-22 8Z', '#C44868');
      } else if (kitHeld === 'tea') {
        kitFill('M-12-4 h22 l-2.2 16.5c-.3 2.2-2.2 3.9-4.4 3.9H-5.4c-2.2 0-4.1-1.7-4.4-3.9Z', '#E8D8C8');
      } else if (kitHeld === 'book') {
        box(-13, -10, 26, 20, 2.4, '#B8506E');
        box(-8.6, -7, 18.6, 14, 1.6, '#FBF6EC');
        box(-13, -10, 5, 20, 2.4, '#8A2E48');
        ctx.strokeStyle = '#C8B8A8';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-5.5, -3.6); ctx.lineTo(6.5, -3.6);
        ctx.moveTo(-5.5, 0); ctx.lineTo(6.5, 0);
        ctx.moveTo(-5.5, 3.6); ctx.lineTo(2.5, 3.6);
        ctx.stroke();
      } else if (kitHeld === 'pencil') {
        kitFill('M-5-12 h10 v18 l-5 6 -5-6 z', '#E8C46A');
        kitFill('M-5-12 h10 v-3.6 l-5-2.8 -5 2.8 z', '#F2A0B4');
        kitFill('M-5 6 l5 6 5-6 z', '#E8D8C8');
        spot(0, 12, 1.6, '#3A3A42');
      } else if (kitHeld === 'lamp') {
        box(-4.6, 3, 9.2, 4, 1.6, '#9AA0A8');
        kitFill('M-7 11 h14 l-2.4 4 h-9.2 z', '#7A8088');
        spot(0, -4, 8.6, '#F6E08A');
        ctx.strokeStyle = '#E8C46A';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-2.6, 0); ctx.lineTo(0, -5); ctx.lineTo(2.6, 0);
        ctx.stroke();
        spot(-3, -7, 1.8, 'rgba(255,255,255,0.7)');
      } else if (kitHeld === 'umbrella') {
        ctx.strokeStyle = '#8A7058';
        ctx.lineWidth = 1.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -13); ctx.lineTo(0, -7);
        ctx.stroke();
        kitFill('M-16-2 a16 11 0 0 1 32 0 z', '#6A90C8');
        ctx.strokeStyle = '#8A7058';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(0, 11);
        ctx.arc(3.4, 11, 3.4, Math.PI, 0, true);
        ctx.stroke();
      } else if (kitHeld === 'icecream') {
        kitFill('M-8 1 L8 1 L0 18 z', '#E8C46A');
        ctx.strokeStyle = 'rgba(140,100,50,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-5, 5); ctx.lineTo(2, 5);
        ctx.moveTo(-3.4, 9); ctx.lineTo(1.4, 9);
        ctx.stroke();
        spot(-4, -4, 6, '#F4A0B4');
        spot(4, -4, 6, '#F6C8D4');
        spot(0, -9.5, 5.6, '#FFF3E0');
      } else if (kitHeld === 'guitar') {
        box(-2, -18, 4, 12, 1.4, '#8A5A32');
        box(-3.4, -19, 6.8, 3, 1.2, '#6A4222');
        oval(0, -2, 7, 6, '#C4885A');
        oval(0, 7, 9.2, 7.6, '#C4885A');
        spot(0, 4.6, 2.6, '#3A2A20');
        ctx.strokeStyle = 'rgba(250,240,225,0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-1.2, -10); ctx.lineTo(-1.2, 6);
        ctx.moveTo(1.2, -10); ctx.lineTo(1.2, 6);
        ctx.stroke();
      } else if (kitHeld === 'camera') {
        box(-6, -10.5, 12, 5, 1.6, '#4A4E56');
        box(-14, -6, 28, 17.5, 3.4, '#4A4E56');
        spot(0, 2.4, 6.6, '#2A2E34');
        spot(0, 2.4, 3.4, '#7AB8D8');
        spot(9, -3, 1.7, '#E8C46A');
      } else if (kitHeld === 'balloon') {
        oval(0, -5, 9.4, 10.4, '#E07090');
        kitFill('M-2 5.2 h4 l-2 3 z', '#C44868');
        ctx.strokeStyle = '#8A7058';
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 8.2);
        ctx.quadraticCurveTo(4, 11.2, 0, 15.6);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        oval(-3, -9, 2.6, 3.4, '#FFFFFF');
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    function applyPose(pose) {
      lastPose = pose;
      var b = pose.body;
      var yaw = b.yaw || 0;
      var sketch = b.sketch || 0;
      bodyColor = b.color || bodyColor;

      eyeSlot(eyeL, pose.left, 0, yaw);
      eyeSlot(eyeR, pose.right, 1, yaw);

      var w = canvas.width;
      var h = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var scale = Math.min(w / VIEW_W, h / VIEW_H);
      ctx.setTransform(
        scale, 0, 0, scale,
        (w - VIEW_W * scale) / 2,
        (h - VIEW_H * scale) / 2,
      );
      ctx.translate(-ORIGIN_X, -ORIGIN_Y);

      ctx.save();
      ctx.translate(HEAD_C + b.x, HEAD_C + b.y);
      ctx.rotate((b.rotate || 0) * Math.PI / 180);
      ctx.scale(b.scale, b.scale);
      ctx.translate(-HEAD_C, -HEAD_C);

      ctx.beginPath();
      ringToPath(ctx, headRing);
      if (sketch > 0.5) {
        ctx.fillStyle = 'transparent';
        ctx.strokeStyle = shade(bodyColor, -0.55);
        ctx.lineWidth = 2.2;
        ctx.stroke();
      } else {
        var g = ctx.createRadialGradient(
          HEAD_C - 28, HEAD_C - 36, 8,
          HEAD_C, HEAD_C, 120,
        );
        g.addColorStop(0, shade(bodyColor, 0.35));
        g.addColorStop(0.55, bodyColor);
        g.addColorStop(1, shade(bodyColor, -0.22));
        ctx.fillStyle = g;
        ctx.fill();
      }

      drawEye(eyeL);
      drawEye(eyeR);
      drawBuiltInGlasses();
      drawBuiltInHat(yaw);
      drawBuiltInHeld(yaw);
      ctx.restore();
    }

    function setLite(on) { lite = !!on; }
    function burst() { /* canvas path skips particle FX */ }
    function setKit(kind) {
      var split = splitLegacyKit(kind);
      kitHat = split.hat;
      kitGlasses = split.glasses;
      kitHeld = 'none';
      hatImage = '';
      glassesImage = '';
      heldImage = '';
      loadBitmap('', 'hat');
      loadBitmap('', 'glasses');
      loadBitmap('', 'held');
    }
    function setDressing(hat, glasses, held, image) {
      var imgs = (image && typeof image === 'object' && !isBitmap(image)) ? image : {};
      var legacyHeld = typeof image === 'string' || isBitmap(image) ? image : '';
      kitHat = hat || 'none';
      kitGlasses = glasses || 'none';
      kitHeld = held || 'none';
      hatImage = (typeof imgs.hat === 'string' || isBitmap(imgs.hat)) ? imgs.hat : '';
      glassesImage = (typeof imgs.glasses === 'string' || isBitmap(imgs.glasses)) ? imgs.glasses : '';
      heldImage = legacyHeld || ((typeof imgs.held === 'string' || isBitmap(imgs.held)) ? imgs.held : '');
      loadBitmap(hatImage, 'hat');
      loadBitmap(glassesImage, 'glasses');
      loadBitmap(heldImage, 'held');
    }
    function destroy() {
      lastPose = null;
      if (!isOffscreen && canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    }

    return {
      canvas: canvas,
      applyPose: applyPose,
      burst: burst,
      setKit: setKit,
      setDressing: setDressing,
      setLite: setLite,
      resize: resize,
      destroy: destroy,
    };
  }

  EB.createBall = createBall;
  EB.renderBackend = 'canvas';
})();
