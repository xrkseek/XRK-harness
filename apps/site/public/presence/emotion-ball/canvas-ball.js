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

    /** Glasses sticker tracks the visible eyes and drops off the far side of a turn. */
    function drawGlassesSticker(img) {
      var L = eyeL.slot;
      var R = eyeR.slot;
      if (!L && !R) return;
      var cx;
      var cy;
      var w;
      var h;
      if (L && R) {
        var foreshorten = Math.min(Math.abs(L.sx || 0), Math.abs(R.sx || 0));
        var span = Math.abs(R.x - L.x);
        /* Edge-on: both lenses have collapsed — do not leave a front-facing SVG. */
        if (foreshorten < 0.12 && span < 18) return;
        cx = (L.x + R.x) / 2;
        cy = (L.y + R.y) / 2;
        w = Math.max(16, span + 28 * foreshorten);
        h = Math.max(8, w * 0.42 * (0.35 + 0.65 * foreshorten));
      } else {
        var one = L || R;
        var sx = Math.abs(one.sx || 0);
        if (sx < 0.12) return;
        cx = one.x;
        cy = one.y;
        w = Math.max(14, 40 * sx);
        h = Math.max(8, w * 0.5);
      }
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
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
        cy = silMinY - 6;
        w = 72;
        h = 48;
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
      var yOff = isHalo ? -28
        : (kitHat === 'visor' ? 6 : (kitHat === 'cap' ? 2 : (kitHat === 'beanie' ? 0 : -4)));
      var y = silMinY + yOff;
      var sampleY = Math.min(silMaxY - 4, Math.max(silMinY + 6, y + 14));
      var band = silAt(sampleY);
      var hw = Math.max((band[1] - band[0]) / 2, 14);
      var cx = (band[0] + band[1]) / 2;
      var x = cx + hw * Math.sin(yaw || 0) * (isHalo ? 0.22 : 0.74);
      var cnAbs = Math.abs(cn);
      var sx = isHalo ? (0.55 + 0.45 * cnAbs) : (0.45 + 0.55 * Math.max(cn, 0));
      var fit = hw / (isHalo ? 48 : 54);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(fit * sx, fit);
      if (isHalo) ctx.rotate(-8 * Math.PI / 180);
      var crown = shade(bodyColor, -0.35);
      var brim = shade(bodyColor, -0.18);
      if (kitHat === 'bow') {
        kitFill('M-22-2c0-7 7-12 13-8 4 3 6 7 9 10 3-3 5-7 9-10 6-4 13 1 13 8 0 5-4 8-9 8-4 0-7-2-10-5-3 3-6 5-10 5-5 0-9-3-9-8z', '#E07090');
        ctx.fillStyle = '#C44868';
        ctx.beginPath();
        ctx.arc(0, 1, 4.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (kitHat === 'cap') {
        ctx.fillStyle = brim;
        ctx.beginPath();
        ctx.ellipse(0, 12, 30, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        kitFill('M-21 11c0-17 9.5-28 21-28s21 11 21 28H-21z', crown);
      } else if (kitHat === 'beanie') {
        kitFill('M-22 14c0-18 10-30 22-30s22 12 22 30H-22z', crown);
        ctx.fillStyle = brim;
        ctx.fillRect(-24, 10, 48, 8);
        ctx.beginPath();
        ctx.arc(0, -14, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = shade(bodyColor, -0.22);
        ctx.fill();
      } else if (kitHat === 'visor') {
        ctx.fillStyle = shade(bodyColor, -0.22);
        ctx.fillRect(-22, 2, 44, 6);
        ctx.fillStyle = brim;
        ctx.beginPath();
        ctx.ellipse(0, 12, 32, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (kitHat === 'halo') {
        ctx.strokeStyle = '#E8C46A';
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.ellipse(0, 0, 36, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
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
        : (kitGlasses === 'specs-cat' ? 'cat' : 'round');
      var sun = kitGlasses === 'specs-sun';
      var fill = sun ? 'rgba(28,28,32,0.72)' : 'rgba(255,255,255,0.16)';
      var stroke = sun ? '#4A241C' : '#2A2A30';
      var L = eyeL.slot;
      var R = eyeR.slot;
      function lens(slot, other, side) {
        if (!slot || Math.abs(slot.sx || 0) < 0.08) return null;
        var sz = lensRadii(slot, other);
        ctx.save();
        ctx.translate(slot.x, slot.y);
        if (slot.rotate) ctx.rotate(slot.rotate * Math.PI / 180);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        if (shape === 'rect') {
          var rh = sz.ry * 1.7;
          var rad = Math.min(7, sz.rx * 0.28);
          if (typeof ctx.roundRect === 'function') ctx.roundRect(-sz.rx, -rh / 2, sz.rx * 2, rh, rad);
          else ctx.rect(-sz.rx, -rh / 2, sz.rx * 2, rh);
          ctx.fill();
          ctx.stroke();
        } else if (shape === 'cat') {
          traceCatLens(side, sz.rx, sz.ry);
        } else {
          ctx.ellipse(0, 0, sz.rx, sz.ry * (sun ? 0.82 : 1), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
        return sz;
      }
      var lsz = lens(L, R, -1);
      var rsz = lens(R, L, 1);
      if (lsz && rsz && shape !== 'cat') {
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
