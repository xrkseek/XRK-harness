/* ============================================================
 * ball.js —— 渲染层（纯渲染，不含业务逻辑）
 *
 *   坐标系：viewBox -15 -15 259 259，头部中心 HEAD_C = 114.2705
 *   身体：形状轮廓环（blob 圆胖 / wedge 三角 / gem 菱形）折线路径
 *   眼睛：25 组表情眼环（48 点轮廓），由 engine 逐点插值后传入，
 *        本层负责球面投影、变换与 path 更新
 *   球面投影：按眼睛当前高度采样身体轮廓的局部半宽，经度换算 + 余弦压缩，
 *            自旋偏航时眼睛绕到背面自动隐藏（cos <= 0.02 判定）
 *   彩带：两种形态 ——
 *        自旋甩带（角速度达阈值时甩出、减速后回缩的 3D 轨道拖尾）
 *        常驻环带（低倾角水平轨道持续环绕，用于"思考中"等状态）
 *        均使用 5-stop 色相漂移渐变 + 头宽尾细轮廓 + 圆头封口
 *   撒花：一次性物理粒子（速度衰减 + 微重力 + 金色五角星混入）
 *   zzz：睡眠状态右上角循环漂浮的字母粒子
 * ============================================================ */
(function () {
  'use strict';

  var EB = (globalThis.EmotionBall = globalThis.EmotionBall || {});
  var RD = globalThis.EB_RINGS;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var uid = 0;
  var TAU = Math.PI * 2;

  var HEAD_C = RD.HEAD_C;          /* 114.2705 */
  var EYE_HALF = RD.EYE_HALF;      /* 21 */
  var EXPR = RD.EXPRESSIONS;
  var STAR_GOLD = RD.STAR_GOLD;
  var CONFETTI_COLORS = ['#f9705c', '#5b95f0', '#3fbe86', '#f5b13f', '#9a72ee', '#35c3bd'];
  /* 五角星 path（内径比 0.42） */
  var STAR_PATH = (function () {
    var pts = [];
    for (var e = 0; e < 10; e++) {
      var a = -Math.PI / 2 + e * Math.PI / 5;
      var r = e % 2 === 0 ? 1 : 0.42;
      pts.push((Math.cos(a) * r).toFixed(3) + ' ' + (Math.sin(a) * r).toFixed(3));
    }
    return 'M' + pts.join('L') + 'Z';
  })();

  function el(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function shade(hex, amt) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var target = amt < 0 ? 0 : 255;
    var a = Math.abs(amt);
    r = Math.round(r + (target - r) * a);
    g = Math.round(g + (target - g) * a);
    b = Math.round(b + (target - b) * a);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /* 轮廓环 → 闭合折线 path；48 点密度下视觉平滑 */
  function ringPath(ring) {
    var s = 'M';
    for (var i = 0; i < ring.length; i++) {
      s += (i ? 'L' : '') + ring[i][0].toFixed(2) + ' ' + ring[i][1].toFixed(2);
    }
    return s + 'Z';
  }
  function centroid(ring) {
    var x = 0, y = 0;
    for (var i = 0; i < ring.length; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / ring.length, y / ring.length];
  }

  function createBall(container, opts) {
    opts = opts || {};
    var id = 'eb' + (uid++);
    /* Mutable: Presence can drop to lite under stream load without remount. */
    var lite = !!opts.lite;
    var kitDirty = true;
    var lastKitKey = '';
    var shape = RD.SHAPES[opts.shape] || RD.SHAPES.blob;
    var face = shape.face;
    var headRing = shape.ring;

    /* ---- 形状轮廓采样：每 2px 一行的 [minX, maxX]，供眼睛贴合任意身体轮廓 ---- */
    var silMinY = 1e9, silMaxY = -1e9;
    var i, p;
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
          if (y < (y0 < y1 ? y0 : y1) || y > (y0 < y1 ? y1 : y0)) continue;
          if (y0 === y1) {
            /* Horizontal edge lying on this scan line: both ends are on it.
             * Taking only a[0] (t=0) drops the right bound and drags the eyes
             * sideways — very visible on low-vertex shapes like star. */
            if (a[0] < lo) lo = a[0];
            if (b[0] < lo) lo = b[0];
            if (a[0] > hi) hi = a[0];
            if (b[0] > hi) hi = b[0];
            continue;
          }
          var x = a[0] + (b[0] - a[0]) * ((y - y0) / (y1 - y0));
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        if (lo > hi) { lo = HEAD_C - 4; hi = HEAD_C + 4; }
        silRows.push([lo, hi]);
      }
    })();
    function silAt(y) {
      var r = Math.round((clamp(y, silMinY, silMaxY) - silMinY) / SIL_STEP);
      return silRows[clamp(r, 0, silRows.length - 1)];
    }

    /* ---- SVG 骨架 ---- */
    /* Top pad to y=-100: bounce peak ≈ -58, halo ≈ -28 → about -86. */
    var svg = el('svg', {
      viewBox: '-15 -100 259 344',
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': opts.label || 'AI 表情小球',
      preserveAspectRatio: 'xMidYMid meet',
    });
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    var defs = el('defs', {});
    var grad = el('radialGradient', { id: id + 'g', cx: '38%', cy: '32%', r: '75%' });
    var stopA = el('stop', { offset: '0%' });
    var stopB = el('stop', { offset: '62%' });
    var stopC = el('stop', { offset: '100%' });
    grad.appendChild(stopA); grad.appendChild(stopB); grad.appendChild(stopC);
    defs.appendChild(grad);
    svg.appendChild(defs);

    var fxBack = el('g', { 'pointer-events': 'none' });
    svg.appendChild(fxBack);

    var bodyG = el('g', {});
    var head = el('path', { d: ringPath(headRing), fill: 'url(#' + id + 'g)', stroke: 'none', 'stroke-width': '2' });
    bodyG.appendChild(head);

    function buildEye(k) {
      var node = el('path', { fill: '#1A1A1A', stroke: 'none', 'stroke-width': '1.6' });
      node.setAttribute('d', ringPath(EXPR[0][k]));
      return { node: node, ring: EXPR[0][k], c: centroid(EXPR[0][k]) };
    }
    var eyeL = buildEye(0);
    var eyeR = buildEye(1);
    bodyG.appendChild(eyeL.node);
    bodyG.appendChild(eyeR.node);
    var hatG = el('g', { 'pointer-events': 'none' });
    var specsG = el('g', { 'pointer-events': 'none' });
    var heldG = el('g', { 'pointer-events': 'none' });
    bodyG.appendChild(hatG);
    bodyG.appendChild(specsG);
    bodyG.appendChild(heldG);
    function splitLegacyKit(kind) {
      if (!kind || kind === 'none') return { hat: 'none', glasses: 'none' };
      if (String(kind).indexOf('specs') === 0) return { hat: 'none', glasses: kind };
      return { hat: kind, glasses: 'none' };
    }
    var split0 = splitLegacyKit(opts.kit);
    var kitHat = opts.kitHat || split0.hat;
    var kitGlasses = opts.kitGlasses || split0.glasses;
    var kitHeld = opts.kitHeld || 'none';
    /* 当前内置镜片形状：layoutSpecsLens 据此套 SPEC_SHAPE_TWEAK（贴纸不吃这份微调）。 */
    var curSpecShape = 'round';
    /* 三槽贴图：与内置图形平级。贴图放进 hatG/specsG/heldG，因而天然继承
     * bodyG 的 translate/rotate/scale —— 呼吸、转头、情绪形变全部跟随身体。
     * 绝不要退回 DOM 层绝对定位，那只会钉死在 CSS 盒子上。 */
    var hatImage = typeof opts.hatImage === 'string' ? opts.hatImage : '';
    var glassesImage = typeof opts.glassesImage === 'string' ? opts.glassesImage : '';
    var heldImage = typeof opts.heldImage === 'string' ? opts.heldImage : '';
    svg.appendChild(bodyG);

    var fxFront = el('g', { 'pointer-events': 'none' });
    svg.appendChild(fxFront);

    /* 眼睛基准中心：默认表情环的质心 */
    var BASE_C = [centroid(EXPR[0][0]), centroid(EXPR[0][1])];

    /* ---- zzz 睡眠粒子：三枚字母沿右上方向循环漂浮（full 模式懒创建） ---- */
    var zzzNodes = null;
    function ensureZzz() {
      if (zzzNodes) return;
      zzzNodes = [];
      for (var zi = 0; zi < 3; zi++) {
        var zn = el('text', {
          x: 0, y: 0, fill: '#A8A296', opacity: '0',
          'font-family': "'Space Grotesk', 'Noto Sans SC', sans-serif",
          'font-weight': '700', 'font-style': 'italic', 'text-anchor': 'middle'
        });
        zn.textContent = 'z';
        fxFront.appendChild(zn);
        zzzNodes.push(zn);
      }
    }
    if (!lite) ensureZzz();

    container.appendChild(svg);

    /* ---- 彩带：3D 轨道拖尾 ---- */
    var trails = [];
    var planes = [];
    var planeG = 4;
    var baseHue = 0;
    var spawnAt = [];
    var spawnIdx = 0;
    var wasFast = false;
    var prevYaw = 0, prevNow = 0;
    var orbitNextAt = 0;
    var confPieces = [];

    function makePlanes() {
      /* 多轨道面交错：2~3 个不同倾角 / 滚转的平面，彩带轮流落在各面上，
       * 甩出的弧线在多个角度方向上交错，而非单一平面里的一组平行弧 */
      planes = [];
      var n = Math.random() < 0.45 ? 2 : 3;
      var roll0 = rand(-0.9, 0.9);
      for (var pi = 0; pi < n; pi++) {
        planes.push({
          tilt: rand(0.16, 0.72),
          roll: roll0 + pi * (Math.PI / n) + rand(-0.15, 0.15)
        });
      }
      planeG = Math.round(rand(4, 6));
      baseHue = rand(0, 360);
      spawnIdx = 0;
    }

    function orbitPoint(o, lam) {
      var hx = o.rad * Math.sin(lam);
      var hy = -o.rad * Math.cos(lam) * Math.sin(o.tilt);
      var ca = Math.cos(o.roll), sa = Math.sin(o.roll);
      return {
        x: HEAD_C + hx * ca - hy * sa,
        y: HEAD_C + hx * sa + hy * ca,
        z: Math.cos(lam) * Math.cos(o.tilt),
        l: lam
      };
    }

    /** 创建一条拖尾：独立 5-stop 渐变 + 前后两段 path */
    function createTrail(cfg) {
      if (trails.length > 8) return;
      var gradEl = el('linearGradient', { id: id + 'tg' + (uid++), gradientUnits: 'userSpaceOnUse' });
      var stops = [];
      for (var s = 0; s < 5; s++) {
        var st = el('stop', { offset: (s / 4).toFixed(3) });
        gradEl.appendChild(st);
        stops.push(st);
      }
      defs.appendChild(gradEl);
      var fill = 'url(#' + gradEl.getAttribute('id') + ')';
      var back = el('path', { stroke: 'none', fill: fill, opacity: '0' });
      var front = el('path', { stroke: 'none', fill: fill, opacity: '0' });
      fxBack.appendChild(back);
      fxFront.appendChild(front);
      trails.push({
        o: cfg.o, r: cfg.r, life: 0, ret: 0, hist: [],
        orbitMode: !!cfg.orbit,
        hue: cfg.hue,
        hueSpan: rand(45, 95) * (Math.random() < 0.5 ? 1 : -1),
        hueVel: rand(18, 42) * (Math.random() < 0.5 ? 1 : -1),
        gradEl: gradEl, stops: stops, back: back, front: front
      });
    }

    /** 自旋甩带：沿本次自旋的多个轨道平面轮流错峰甩出 */
    function spawnTrail(lam0, dir) {
      var pl = planes[spawnIdx % planes.length];
      var tierStep = 38 / Math.max(planeG - 1, 1);
      var rw = planeG <= 3 ? rand(8, 10.5) : planeG === 4 ? rand(6.6, 8.6) : rand(5.6, 7.4);
      createTrail({
        o: {
          lam: lam0, lamVel: dir * rand(0.5, 1.1),
          tilt: pl.tilt + rand(-0.04, 0.04),
          roll: pl.roll + rand(-0.05, 0.05),
          rad: 116 + spawnIdx * tierStep + rand(-1.5, 1.5),
          radVel: rand(0, 2.5),
          follow: rand(0.74, 0.94),
          carry: 0,
          arc: rand(2.2, 3.4)
        },
        r: rw,
        hue: baseHue + 360 * spawnIdx / Math.max(planeG, 1) + rand(-14, 14)
      });
      spawnIdx++;
    }

    /** 常驻环带：低倾角水平轨道匀速环绕（"思考中"等状态的持续效果） */
    function spawnOrbit(idx) {
      createTrail({
        orbit: true,
        o: {
          lam: rand(0, TAU),
          lamVel: (Math.random() < 0.5 ? -1 : 1) * rand(1.7, 2.3),
          tilt: rand(0.1, 0.22),
          roll: rand(-0.12, 0.12),
          rad: 124 + idx * 16,
          radVel: 0,
          follow: 0.8,
          carry: 0,
          arc: rand(2.4, 3.2)
        },
        r: rand(5.5, 7),
        hue: rand(0, 360)
      });
    }

    /* 拖尾轮廓：头宽尾细 + 首尾圆头封口，按 z 正负拆为前 / 后两段 */
    function buildTrail(pts, width) {
      var n = pts.length;
      var nx = [], ny = [], e;
      for (e = 0; e < n; e++) {
        var p0 = pts[e > 0 ? e - 1 : 0], p1 = pts[e < n - 1 ? e + 1 : n - 1];
        var dx = p1.x - p0.x, dy = p1.y - p0.y;
        var h = Math.hypot(dx, dy) || 1;
        dx /= h; dy /= h;
        var d = width * (0.5 + (e / (n - 1)) * 0.5) / 2;
        nx.push(-dy * d); ny.push(dx * d);
      }
      function cap(idx) {
        var hw = Math.max(Math.hypot(nx[idx], ny[idx]), 0.2);
        return 'A' + r2(hw) + ' ' + r2(hw) + ' 0 0 0 ';
      }
      function seg(a, b) {
        var s = '', k;
        for (k = a; k <= b; k++) s += (k === a ? 'M' : 'L') + r2(pts[k].x + nx[k]) + ' ' + r2(pts[k].y + ny[k]);
        s += b === n - 1 ? cap(b) : 'L';
        for (k = b; k >= a; k--) s += (k === b ? '' : 'L') + r2(pts[k].x - nx[k]) + ' ' + r2(pts[k].y - ny[k]);
        if (a === 0) s += cap(0) + r2(pts[0].x + nx[0]) + ' ' + r2(pts[0].y + ny[0]);
        return s + 'Z';
      }
      var front = '', back = '', d0 = 0;
      while (d0 < n) {
        var isF = pts[d0].z >= 0;
        var i2 = d0;
        while (i2 + 1 < n && (pts[i2 + 1].z >= 0) === isF) i2++;
        var a2 = Math.max(d0 - 1, 0), b2 = Math.min(i2 + 1, n - 1);
        if (b2 > a2) {
          var str = seg(a2, b2);
          if (isF) front += str; else back += str;
        }
        d0 = i2 + 1;
      }
      return { front: front, back: back };
    }

    function removeTrail(idx) {
      var rb = trails[idx];
      rb.back.remove(); rb.front.remove(); rb.gradEl.remove();
      trails.splice(idx, 1);
    }

    /** Drop ribbons / confetti / zzz when entering lite so stream load stays cheap. */
    function clearHeavyFx() {
      while (trails.length) removeTrail(trails.length - 1);
      spawnAt.length = 0;
      wasFast = false;
      for (var ci = confPieces.length - 1; ci >= 0; ci--) {
        confPieces[ci].el.remove();
      }
      confPieces.length = 0;
      if (zzzNodes) {
        for (var z = 0; z < zzzNodes.length; z++) {
          if (zzzNodes[z].getAttribute('opacity') !== '0') {
            zzzNodes[z].setAttribute('opacity', '0');
          }
        }
      }
    }

    /**
     * Runtime budget toggle — no remount.
     * @param {boolean} on
     */
    function setLite(on) {
      on = !!on;
      if (on === lite) return;
      lite = on;
      if (lite) clearHeavyFx();
      else ensureZzz();
    }

    /* ---- 撒花：一次性物理粒子爆发 ---- */
    function burst(count) {
      if (lite) return;
      count = count || 20;
      for (var i = 0; i < count && confPieces.length < 60; i++) {
        var ang = (i / count) * TAU + rand(-0.35, 0.35);
        var spd = rand(170, 360);
        var star = Math.random() < 0.18;
        var round = !star && Math.random() < 0.3;
        var node;
        if (star) node = el('path', { d: STAR_PATH, fill: STAR_GOLD });
        else if (round) node = el('circle', { r: 1, fill: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0] });
        else node = el('rect', { x: -0.5, y: -0.5, width: 1, height: 1, rx: 0.24, fill: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0] });
        fxFront.appendChild(node);
        confPieces.push({
          x: HEAD_C + Math.cos(ang) * rand(96, 116),
          y: HEAD_C + Math.sin(ang) * rand(96, 116),
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - rand(20, 75),
          life: 0, max: rand(0.45, 0.85),
          r: star ? rand(4, 7) : rand(3.5, 8),
          rot: rand(0, 360), vr: rand(-260, 260),
          stretch: (!star && !round) ? 1.9 : 1,
          el: node
        });
      }
    }

    /* ---- 状态缓存 ---- */
    var curBodyColor = null;
    var curSketch = -1;
    var lastYaw = 0;
    var SPEC_SCALE = 1.42;
    /** 贴纸镜片略大于内置：半幅图有描边留白，且不再叠引擎鼻梁/镜腿。 */
    var STICKER_SPEC_BOOST = 1.38;
    var SPEC_BRIDGE = 10;
    var CAT_LENS = 'M-1,0 C-1,-0.82 -0.2,-1.02 0.12,-0.7 C0.82,-1.18 1.18,-0.18 1,0.12 C0.5,0.82 -0.55,0.68 -1,0 Z';

    /* Aviator: flat brow, deep teardrop bottom. */
    var AVIATOR_LENS = 'M-1,-0.68 L1,-0.68 C1,0.34 0.62,1 -0.01,1 C-0.64,1 -1,0.34 -1,-0.68 Z';
    /* Cyber: chamfered rectangle; the glow line is added separately. */
    var CYBER_LENS = 'M-0.84,-0.9 L0.84,-0.9 L1,0.08 L0.66,0.9 L-0.66,0.9 L-1,0.08 Z';

    function parseRgb(hex) {
      var h = String(hex || '#F3F0EA').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      if (!isFinite(n)) return [243, 240, 234];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    /** 体色 → [h(0..360), s(0..1), l(0..1)]，kitPalette 的相位来源。 */
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

    /** 越界入 0..360，避免 hsl() 负相位被浏览器当无效值丢掉。 */
    function hsl(h, s, l, a) {
      var hue = ((h % 360) + 360) % 360;
      var sat = Math.round(clamp(s, 0, 1) * 100);
      var lig = Math.round(clamp(l, 0, 1) * 100);
      return a === undefined
        ? 'hsl(' + hue.toFixed(0) + ', ' + sat + '%, ' + lig + '%)'
        : 'hsla(' + hue.toFixed(0) + ', ' + sat + '%, ' + lig + '%, ' + a + ')';
    }

    /**
     * 装扮配色全部从体色的 HSL 相位推出来 —— 57 种体色都能自动得到协调的
     * 描边 / 镜片 / 帽檐 / 帽体 / 装饰 / 蝴蝶结 / 光环，不必逐个手调。
     * 深色球（相对亮度 < 0.32）同相位再怎么加亮都发闷，装饰件走固定亮色。
     */
    function kitPalette(body, hatKind) {
      var rgb = parseRgb(body);
      var L = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      var hs = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      var h = hs[0], s = hs[1], l = hs[2];
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
          /* 描边取同相位压深的低彩度，纯黑会压住低饱和体色 */
          frame: hsl(h, s * 0.55, 0.16),
          lens: hsl(h, s + 0.12, 0.62, 0.14),
          lensSun: hsl(h, s + 0.16, 0.2, 0.58),
          brim: hsl(h, s * 0.7, l * 0.34),
          crown: hsl(h, s * 0.95, l * 0.6),
          /* 装饰件错开相位：同相位只会把整套帽子糊成一坨 */
          accent: hsl(h + 38, s + 0.22, l * 0.78),
          bow: hsl(h - 28, s + 0.2, l * 0.92),
          knot: hsl(h - 28, s + 0.24, l * 0.68),
          halo: hsl(h + 46, 0.62, 0.72),
        };
      }
      /* 缝线默认跟镜框走；帽款想单独上色就在 HAT_PALETTES 里给 seam。 */
      pal.seam = pal.frame;
      /* HAT_PALETTES 在 paintKit 段才赋值，早于它的 setBodyColor 初始化会拿到
       * undefined —— 先判存在再取键，别让首帧抛错。 */
      var hat = hatKind && HAT_PALETTES ? HAT_PALETTES[hatKind] : null;
      if (hat) {
        for (var key in hat) {
          if (Object.prototype.hasOwnProperty.call(hat, key)) pal[key] = hat[key];
        }
      }
      return pal;
    }

    function setBodyColor(color) {
      if (color === curBodyColor) return;
      curBodyColor = color;
      stopA.setAttribute('stop-color', shade(color, 0.22));
      stopB.setAttribute('stop-color', color);
      stopC.setAttribute('stop-color', shade(color, -0.12));
      if (curSketch > 0.5) head.style.stroke = 'var(--sketch-ink, ' + shade(color, -0.6) + ')';
      paintKit();
    }

    function isSpecsKit(kind) {
      return typeof kind === 'string' && kind.indexOf('specs') === 0;
    }

    /** Map kitGlasses id → lens shape. New built-in: add a branch + PRESENCE_GLASSES_KITS. */
    function specsShapeOf(kind) {
      if (kind === 'specs-rect') return 'wayfarer';
      if (kind === 'specs-cat') return 'cat';
      if (kind === 'specs-round-xl') return 'sport';
      if (kind === 'specs-oval') return 'oval';
      if (kind === 'specs-square') return 'square';
      if (kind === 'specs-half') return 'half';
      if (kind === 'specs-rimless') return 'rimless';
      if (kind === 'specs-monocle') return 'monocle';
      if (kind === 'specs-heart') return 'cyber';
      if (kind === 'specs-shades') return 'shades';
      if (kind === 'specs-sun') return 'aviator';
      return 'round-metal';
    }

    /** 镜片形状的几何微调：只改尺寸/描边，不动 lens-L/R 的锚定机制。 */
    var SPEC_SHAPE_TWEAK = {
      'round-metal': { rx: 1.04, ry: 1.04 },
      wayfarer: { rx: 1.1, ry: 0.9, box: 1.8 },
      cat: { rx: 1.12, ry: 1 },
      aviator: { rx: 1.06, ry: 1.18 },
      sport: { rx: 1.2, ry: 1.14, grow: 6 },
      oval: { rx: 1.16, ry: 0.72 },
      square: { rx: 1.02, ry: 0.98, box: 1.86 },
      half: { rx: 1.06, ry: 1.02 },
      rimless: { rx: 1.04, ry: 1.04 },
      monocle: { rx: 1.1, ry: 1.1 },
      cyber: { rx: 1.08, ry: 0.94, box: 1.8 },
      /* 连体镜把两片各向内多推 5px，中央缝合成一片式 */
      shades: { rx: 1, ry: 1, grow: 5, box: 1.52 },
    };

    /* Negative lifts above silMinY (SVG y grows down). Caps sit on the crown;
     * halo floats well clear so bounce/spin never looks welded into the head.
     * 帽檐底边大致落在 silMinY + 6..10（帽体局部 y≈14 × fit），才是「扣在脑门上」。 */
    var HAT_Y_OFF = {
      halo: -28,
      antenna: -2,
      wizard: 0,
      tophat: 0,
      party: 1,
      crown: 1,
      cake: 1,
      chef: 1,
      bow: -4,
      'flower-crown': 1,
      'cat-ears': 1,
      straw: 0,
      beanie: 0,
      headphones: 0,
      cap: 2,
      bucket: 1,
      beret: -2,
      /* 遮阳帽只是箍 + 前檐，内容整体压在 y≥2；正向偏移会把帽檐落到眼睛上，
       * 所以给它负偏移，让箍贴住头顶、檐口停在眉骨上方。 */
      visor: -4,
    };
    /* 造型宽窄不一：窄身款按 nominal 54 缩放后偏小，单独补偿到同一视觉体量。
     * （帽子本体按 54 宽设计，这里只做整体放大，不改形状内部比例。） */
    var HAT_SCALE = {
      cake: 1.4,
      party: 1.3,
      antenna: 1.3,
      crown: 1.25,
      'flower-crown': 1.2,
      chef: 1.2,
      'cat-ears': 1.15,
      tophat: 1.1,
      wizard: 1.1,
      headphones: 1.06,
      bucket: 1.02,
      beret: 1.06,
    };
    var KIT_ROLE_FILL = {
      brim: 'brim', crown: 'crown', accent: 'accent', bow: 'bow', knot: 'knot',
    };
    var KIT_ROLE_STROKE = { frame: 'frame', halo: 'halo', shine: 'halo', band: 'brim', seam: 'seam' };

    /**
     * 帽款固有色。旧逻辑所有帽子的 crown/brim/accent 都从球的体色派生，
     * 于是 18 款帽子在同一颗球上长得一模一样（全是球色的暗调），
     * 看起来像一顶土黄色帽子换了轮廓。每款按实物取色，球色只留作兜底
     * （以及镜框/缝线这些确实该跟衣服协调的部件）。
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

    function clearKit() {
      while (hatG.firstChild) hatG.removeChild(hatG.firstChild);
      while (specsG.firstChild) specsG.removeChild(specsG.firstChild);
      while (heldG.firstChild) heldG.removeChild(heldG.firstChild);
    }

    function paintKit() {
      if ((kitHat === 'none' && kitGlasses === 'none') || !curBodyColor) return;
      var pal = kitPalette(curBodyColor, kitHat);
      var sun = kitGlasses === 'specs-sun' || kitGlasses === 'specs-shades';
      var nodes = bodyG.querySelectorAll('[data-kit-role]');
      var i;
      for (i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var role = node.getAttribute('data-kit-role');
        if (role === 'lens') {
          var tint = node.getAttribute('data-tint') || '';
          if (tint !== 'both') node.setAttribute('fill', sun ? pal.lensSun : pal.lens);
          if (!tint) node.setAttribute('stroke', pal.frame);
          continue;
        }
        var fillKey = KIT_ROLE_FILL[role];
        if (fillKey) { node.setAttribute('fill', pal[fillKey]); continue; }
        var strokeKey = KIT_ROLE_STROKE[role];
        if (strokeKey) node.setAttribute('stroke', pal[strokeKey]);
      }
    }

    function addLensPair(tag, attrs) {
      var left = { 'data-kit': 'lens-L', 'data-kit-role': 'lens' };
      var right = { 'data-kit': 'lens-R', 'data-kit-role': 'lens' };
      var k;
      for (k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          left[k] = attrs[k];
          right[k] = attrs[k];
        }
      }
      specsG.appendChild(el(tag, left));
      specsG.appendChild(el(tag, right));
    }

    function addSpecsFrame(frameW) {
      var w = frameW || 3.4;
      specsG.appendChild(el('path', {
        'data-kit': 'bridge', 'data-kit-role': 'frame', fill: 'none',
        stroke: '#2A2A30', 'stroke-width': String(w), 'stroke-linecap': 'round',
      }));
      specsG.appendChild(el('path', {
        'data-kit': 'temple-L', 'data-kit-role': 'frame', fill: 'none',
        stroke: '#2A2A30', 'stroke-width': String(w * 0.92), 'stroke-linecap': 'round',
      }));
      specsG.appendChild(el('path', {
        'data-kit': 'temple-R', 'data-kit-role': 'frame', fill: 'none',
        stroke: '#2A2A30', 'stroke-width': String(w * 0.92), 'stroke-linecap': 'round',
      }));
    }

    /** 把 96×32 贴纸裁成左/右半幅独立 data URL，避免 nested viewBox 把整副缩进一只眼。 */
    function glassesHalfHref(image, side) {
      var vb = side === 'left' ? '0 0 48 32' : '48 0 48 32';
      var href = String(image)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" width="48" height="32">' +
        '<svg viewBox="' + vb + '" width="48" height="32" preserveAspectRatio="none">' +
        '<image width="96" height="32" preserveAspectRatio="none" href="' + href + '"/>' +
        '</svg></svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    /** 贴纸双眼：左右半幅各一张 image；框（鼻梁/镜腿）须画在 SVG 里，引擎不再叠黑杠。 */
    function addSpecsSticker(image) {
      specsG.appendChild(el('image', {
        'data-kit': 'lens-L', 'data-kit-role': 'sticker',
        href: glassesHalfHref(image, 'left'),
        preserveAspectRatio: 'none',
      }));
      specsG.appendChild(el('image', {
        'data-kit': 'lens-R', 'data-kit-role': 'sticker',
        href: glassesHalfHref(image, 'right'),
        preserveAspectRatio: 'none',
      }));
    }

    function addSpecsPair(shape, image) {
      /* 贴纸名义框 96×32：左 0–48 / 右 48–96 各跟一只眼；不调用 addSpecsFrame。 */
      if (image) {
        addSpecsSticker(image);
        return;
      }
      var fill = palLens();
      curSpecShape = shape;
      /* 12 副时髦框：每片都走 lens-L/R，layout 按该眼 slot 逐片摆放。
       * path 的坐标是单位框 → stroke-width 也是单位（会被 scale 乘回去）；
       * rect / ellipse 是像素属性，stroke-width 直接给像素。 */
      var frameW = 3.2;
      if (shape === 'wayfarer') {
        addLensPair('rect', {
          fill: fill, stroke: '#2A2A30', 'stroke-width': '4.6',
          rx: '8', ry: '8', opacity: '0.95',
        });
        frameW = 4.4;
      } else if (shape === 'cat') {
        addLensPair('path', {
          d: CAT_LENS, fill: fill, stroke: '#2A2A30', 'stroke-width': '0.2', opacity: '0.95',
        });
        frameW = 3;
      } else if (shape === 'aviator') {
        addLensPair('path', {
          d: AVIATOR_LENS, fill: fill, stroke: '#8A8F98', 'stroke-width': '0.16',
          'data-tint': 'stroke', opacity: '0.95',
        });
        frameW = 2.6;
      } else if (shape === 'half') {
        /* 上半有框、下半只剩淡镜片：单位半环 path，按 ry 压出眉线弧度 */
        addLensPair('path', {
          d: 'M-1 0 A1 1 0 0 1 1 0 Z', fill: fill,
          stroke: '#2A2A30', 'stroke-width': '0.16', opacity: '0.95',
        });
        frameW = 2.6;
      } else if (shape === 'cyber') {
        addLensPair('path', {
          d: CYBER_LENS, fill: 'rgba(28,240,255,0.2)', stroke: '#5AE0FF',
          'stroke-width': '0.2', 'data-tint': 'both', opacity: '0.96',
        });
        frameW = 3;
      } else if (shape === 'rimless') {
        /* 无框：镜片只留淡色，框全部交给鼻梁/镜腿 */
        addLensPair('ellipse', {
          fill: fill, stroke: 'none', 'stroke-width': '0', opacity: '0.9',
        });
        frameW = 2.4;
      } else if (shape === 'round-metal') {
        /* 细金属丝圆框，靠细描边 + 圆桥出「复古」味 */
        addLensPair('ellipse', {
          fill: fill, stroke: '#5E646E', 'stroke-width': '2.2', opacity: '0.95',
        });
        frameW = 2.2;
      } else if (shape === 'monocle') {
        addLensPair('ellipse', {
          fill: fill, stroke: '#C8A24A', 'stroke-width': '2.8',
          'data-tint': 'stroke', opacity: '0.95',
        });
        var leftLens = specsG.querySelector('[data-kit="lens-L"]');
        if (leftLens) leftLens.setAttribute('data-single', '1');
        frameW = 2.6;
      } else if (shape === 'sport') {
        addLensPair('ellipse', {
          fill: fill, stroke: '#2A2A30', 'stroke-width': '3', opacity: '0.95',
        });
        frameW = 3;
      } else if (shape === 'shades') {
        addLensPair('rect', {
          fill: fill, stroke: '#1A1A1E', 'stroke-width': '3', rx: '5', ry: '5', opacity: '0.97',
        });
        frameW = 3;
      } else if (shape === 'square') {
        addLensPair('rect', {
          fill: fill, stroke: '#2A2A30', 'stroke-width': '4.2', rx: '3', ry: '3', opacity: '0.95',
        });
        frameW = 3.8;
      } else {
        /* oval */
        addLensPair('ellipse', {
          fill: fill, stroke: '#2A2A30', 'stroke-width': '2.6', opacity: '0.95',
        });
        frameW = 2.6;
      }
      addSpecsFrame(frameW);
    }

    function palLens() {
      return kitGlasses === 'specs-sun' || kitGlasses === 'specs-shades'
        ? 'rgba(28,28,32,0.52)'
        : 'rgba(255,255,255,0.16)';
    }

    function fillHat(kind, image) {
      if (fillStickerImage(hatG, image, 64, 'sticker')) return;
      if (kind === 'bow') {
        hatG.appendChild(el('path', {
          'data-kit-role': 'bow',
          d: 'M-22-2c0-7 7-12 13-8 4 3 6 7 9 10 3-3 5-7 9-10 6-4 13 1 13 8 0 5-4 8-9 8-4 0-7-2-10-5-3 3-6 5-10 5-5 0-9-3-9-8z',
        }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'knot', cx: '0', cy: '1', r: '4.4' }));
        hatG.appendChild(el('circle', { cx: '-1.2', cy: '-0.4', r: '1.3', fill: '#F4A0B4', opacity: '0.85' }));
        return;
      }
      if (kind === 'cap') {
        /* 真鸭舌：帽体是前半圆的硬顶，鸭舌朝前下方探出（正视图=向下垂的舌头），
         * 舌尖留一道翻边高光，顶扣压在帽顶正中。 */
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown',
          d: 'M-20.5 8.4C-20.5-10.6-11.4-19.6 0-19.6S20.5-10.6 20.5 8.4'
            + 'C13 5 7 3.4 0 3.4S-13 5-20.5 8.4Z',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'brim',
          d: 'M-24.6 8.6C-19.4 16.4-10.8 20.6 0 20.6S19.4 16.4 24.6 8.6'
            + 'C16.4 12.4 8.2 14.1 0 14.1S-16.4 12.4-24.6 8.6Z',
        }));
        hatG.appendChild(el('path', {
          fill: 'rgba(255,255,255,0.32)',
          d: 'M-19 10.8C-14.6 16.6-8 19.2 0 19.2',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'seam', fill: 'none', 'stroke-width': '1.1',
          d: 'M-12.6 5.6C-10.4-4-5.6-9.6 0-9.6',
        }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '0', cy: '-19.2', r: '2.9' }));
        return;
      }
      if (kind === 'bucket') {
        /* 渔夫帽：桶身 + 帽带 + 一圈下垂的宽檐（檐比帽体宽一圈）。 */
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown',
          d: 'M-18.4 3.6C-18.4-9.4-9.4-17.2 0-17.2S18.4-9.4 18.4 3.6Z',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'accent', x: '-18.4', y: '0.4', width: '36.8', height: '5.4', rx: '2.4',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'brim',
          d: 'M-27.4 3.2C-25 12.6-14.6 18.2 0 18.2S25 12.6 27.4 3.2'
            + 'C20.6 8.2 10.8 11.2 0 11.2S-20.6 8.2-27.4 3.2Z',
        }));
        hatG.appendChild(el('path', {
          fill: 'rgba(255,255,255,0.26)',
          d: 'M-24.6 6.4C-19 13.4-10 16.8 0 16.8',
        }));
        return;
      }
      if (kind === 'beret') {
        /* 贝雷帽：歪向一侧的软圆盘 + 揪揪 + 压深的帽箍。 */
        hatG.appendChild(el('ellipse', {
          'data-kit-role': 'crown', cx: '1', cy: '-3.8', rx: '23.4', ry: '12.8',
          transform: 'rotate(-9 1 -3.8)',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'band', fill: 'none', 'stroke-width': '4.6', 'stroke-linecap': 'round',
          d: 'M-20.4 2.2C-13 8.2 12.4 9.2 21.2 0.4',
        }));
        hatG.appendChild(el('path', {
          fill: 'rgba(255,255,255,0.22)',
          d: 'M-12-9.8C-6-13.8 6-14.6 13-10.8',
        }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '13.2', cy: '-14.8', r: '3.2' }));
        return;
      }
      if (kind === 'beanie') {
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown',
          d: 'M-20.6 11.4C-20.6-7.6-11.4-18.4 0-18.4S20.6-7.6 20.6 11.4Z',
        }));
        /* 翻边：宽过帽体的卷边，上面压罗纹 */
        hatG.appendChild(el('rect', {
          'data-kit-role': 'brim', x: '-22.6', y: '6.4', width: '45.2', height: '10.8', rx: '5.2',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'seam', fill: 'none', 'stroke-width': '1.1',
          d: 'M-14.4 7.2v9.4M-7.2 6.8v10.2M0 6.6v10.6M7.2 6.8v10.2M14.4 7.2v9.4',
        }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '0', cy: '-19.8', r: '4.4' }));
        return;
      }
      if (kind === 'visor') {
        hatG.appendChild(el('rect', { 'data-kit-role': 'accent', x: '-22', y: '2', width: '44', height: '6', rx: '2.4' }));
        hatG.appendChild(el('ellipse', { 'data-kit-role': 'brim', cx: '0', cy: '12', rx: '32', ry: '7' }));
        return;
      }
      if (kind === 'halo') {
        hatG.appendChild(el('ellipse', {
          'data-kit-role': 'halo', cx: '0', cy: '0', rx: '36', ry: '10',
          fill: 'none', 'stroke-width': '3.4', opacity: '0.92',
        }));
        hatG.appendChild(el('ellipse', {
          'data-kit-role': 'shine', cx: '-8', cy: '-2', rx: '11', ry: '3.2',
          fill: 'none', 'stroke-width': '1.5', opacity: '0.55',
        }));
        return;
      }
      if (kind === 'crown') {
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown',
          d: 'M-22 12 L-22-10 L-11 1 L0-15 L11 1 L22-10 L22 12 Z',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'brim', x: '-23', y: '8', width: '46', height: '7', rx: '2.4',
        }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '0', cy: '-15', r: '2.8' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '-22', cy: '-10', r: '2.4' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '22', cy: '-10', r: '2.4' }));
        return;
      }
      if (kind === 'tophat') {
        hatG.appendChild(el('ellipse', { 'data-kit-role': 'brim', cx: '0', cy: '10', rx: '28', ry: '5.6' }));
        hatG.appendChild(el('rect', { 'data-kit-role': 'crown', x: '-16', y: '-32', width: '32', height: '42', rx: '3' }));
        hatG.appendChild(el('rect', { 'data-kit-role': 'accent', x: '-16', y: '-1', width: '32', height: '7' }));
        hatG.appendChild(el('rect', { x: '-5', y: '-27', width: '4', height: '20', rx: '2', fill: 'rgba(255,255,255,0.16)' }));
        return;
      }
      if (kind === 'chef') {
        hatG.appendChild(el('rect', { 'data-kit-role': 'brim', x: '-16', y: '2', width: '32', height: '12', rx: '3' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'crown', cx: '-13', cy: '-8', r: '10' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'crown', cx: '13', cy: '-8', r: '10' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'crown', cx: '0', cy: '-15', r: '12' }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'accent', x: '-16', y: '7', width: '32', height: '4', rx: '2',
        }));
        return;
      }
      if (kind === 'party') {
        hatG.appendChild(el('path', { 'data-kit-role': 'crown', d: 'M0-32 L15 10 L-15 10 Z' }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'accent', d: 'M-7.6-11 L7.6-11 L9.4-4 L-9.4-4 Z',
        }));
        hatG.appendChild(el('ellipse', { 'data-kit-role': 'brim', cx: '0', cy: '10', rx: '15', ry: '3.4' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '0', cy: '-33', r: '4' }));
        return;
      }
      if (kind === 'straw') {
        hatG.appendChild(el('ellipse', { 'data-kit-role': 'brim', cx: '0', cy: '8', rx: '32', ry: '7' }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown', d: 'M-18 8c0-14 8-22 18-22s18 8 18 22z',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'accent', x: '-18', y: '-1', width: '36', height: '5', rx: '1.6',
        }));
        return;
      }
      if (kind === 'wizard') {
        hatG.appendChild(el('ellipse', { 'data-kit-role': 'brim', cx: '0', cy: '8', rx: '26', ry: '5.6' }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown',
          d: 'M-13 8 C-10-8 -2-24 9-33 C4-21 8-7 13 8 Z',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'accent',
          d: 'M1-17 l2.2 4.3 4.7 .7 -3.4 3.2 .8 4.7 -4.3-2.3 -4.3 2.3 .8-4.7 -3.4-3.2 4.7-.7z',
        }));
        return;
      }
      if (kind === 'cat-ears') {
        hatG.appendChild(el('path', { 'data-kit-role': 'crown', d: 'M-23 8 L-18-17 L-4-3 Z' }));
        hatG.appendChild(el('path', { 'data-kit-role': 'crown', d: 'M23 8 L18-17 L4-3 Z' }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'brim', x: '-21', y: '2', width: '42', height: '7', rx: '3',
        }));
        hatG.appendChild(el('path', { 'data-kit-role': 'accent', d: 'M-17.6-7 L-15.4-1 L-9.6-1 Z' }));
        hatG.appendChild(el('path', { 'data-kit-role': 'accent', d: 'M17.6-7 L15.4-1 L9.6-1 Z' }));
        return;
      }
      if (kind === 'headphones') {
        hatG.appendChild(el('path', {
          'data-kit-role': 'frame', fill: 'none', 'stroke-width': '5',
          'stroke-linecap': 'round', d: 'M-24 4 A25 25 0 0 1 24 4',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'accent', x: '-29', y: '-8', width: '11', height: '20', rx: '5',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'accent', x: '18', y: '-8', width: '11', height: '20', rx: '5',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'brim', x: '-27.4', y: '-5', width: '7.8', height: '14', rx: '3.6',
        }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'brim', x: '19.6', y: '-5', width: '7.8', height: '14', rx: '3.6',
        }));
        return;
      }
      if (kind === 'antenna') {
        hatG.appendChild(el('path', {
          'data-kit-role': 'frame', fill: 'none', 'stroke-width': '3',
          'stroke-linecap': 'round', d: 'M0-2 L0-19',
        }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '0', cy: '-23', r: '5.6' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'crown', cx: '-1.8', cy: '-25', r: '1.7', opacity: '0.7' }));
        hatG.appendChild(el('rect', {
          'data-kit-role': 'brim', x: '-8', y: '0', width: '16', height: '5', rx: '2.5',
        }));
        return;
      }
      if (kind === 'flower-crown') {
        var wreath = [[-19, 3], [-10, -5], [0, -8], [10, -5], [19, 3]];
        var w;
        for (w = 0; w < wreath.length; w++) {
          hatG.appendChild(el('circle', {
            'data-kit-role': 'accent', cx: String(wreath[w][0]), cy: String(wreath[w][1]), r: '4.6',
          }));
        }
        hatG.appendChild(el('path', {
          'data-kit-role': 'crown', fill: 'none', 'stroke-width': '2.6',
          'stroke-linecap': 'round', d: 'M-22 6 Q0-10 22 6',
        }));
        for (w = 0; w < wreath.length; w++) {
          hatG.appendChild(el('circle', {
            'data-kit-role': 'knot', cx: String(wreath[w][0]), cy: String(wreath[w][1]), r: '1.7',
          }));
        }
        return;
      }
      if (kind === 'cake') {
        /* 生日蛋糕：白奶油体 + 底部波浪奶油 + 一根蜡烛（火苗走 accent）。 */
        hatG.appendChild(el('rect', {
          x: '-19', y: '-4', width: '38', height: '16', rx: '3.2',
          fill: '#FBF6EC', stroke: 'rgba(120,96,70,0.18)', 'stroke-width': '1',
        }));
        hatG.appendChild(el('path', {
          fill: '#FFFBF3',
          d: 'M-19-2 c3 4.6 6.6-2.6 9.5 0 s6.6 4.6 9.5 0 s6.6-4.6 9.5 0 s6.6 4.6 9.5 0 v-4.5 h-38 z',
        }));
        hatG.appendChild(el('path', {
          fill: '#FFFBF3',
          d: 'M-19 10 c3 4.4 6.6-4.4 9.5 0 s6.6 4.4 9.5 0 s6.6-4.4 9.5 0 s6.6 4.4 9.5 0 v2.6 h-38 z',
        }));
        hatG.appendChild(el('rect', {
          x: '-1.7', y: '-29', width: '3.4', height: '25', rx: '1.4', fill: '#F2E6D2',
        }));
        hatG.appendChild(el('path', {
          'data-kit-role': 'accent',
          d: 'M0-37 c4.6 5.4 5.6 8.4 0 11.4 c-5.6-3-4.6-6 0-11.4 z',
        }));
        hatG.appendChild(el('circle', { cx: '-11', cy: '4', r: '2.2', fill: '#E07090' }));
        hatG.appendChild(el('circle', { cx: '0', cy: '6', r: '2.2', fill: '#E8C46A' }));
        hatG.appendChild(el('circle', { cx: '11', cy: '4', r: '2.2', fill: '#7ABAA8' }));
      }
    }

    /** 往一个 kit 层插入一张贴图（透明 PNG/SVG）。boxW×boxH 为名义框
     * （默认正方形），布局层再按真实锚点缩放它。 */
    function fillStickerImage(layer, image, boxW, role, boxH) {
      if (!image) return false;
      var h = boxH === undefined ? boxW : boxH;
      layer.appendChild(el('image', {
        'data-kit': 'image',
        'data-kit-role': role || null,
        href: image,
        x: String(-boxW / 2), y: String(-h / 2),
        width: String(boxW), height: String(h),
        preserveAspectRatio: 'xMidYMid meet',
      }));
      return true;
    }

    function fillHeld(kind, image) {
      if (fillStickerImage(heldG, image, 52, 'sticker')) return;
      /* 品牌徽章：字形表在 rings.js（EB_RINGS.BRANDS），这里只负责摆版。
       * 圆角牌 + 白字形 + 一根短杆，远看是「举着的小牌子」。 */
      var brands = (globalThis.EB_RINGS && globalThis.EB_RINGS.BRANDS) || {};
      var badge = brands[kind];
      if (badge) {
        /* 30×30 的圆角牌：手持整体按 hw/42 缩放，牌面太小的话品牌字形只剩几个像素。 */
        heldG.appendChild(el('path', {
          d: 'M0 8v8', fill: 'none', stroke: badge.color,
          'stroke-width': '3.4', 'stroke-linecap': 'round',
        }));
        heldG.appendChild(el('rect', {
          x: '-15', y: '-21', width: '30', height: '30', rx: '8.4',
          fill: badge.color, stroke: 'rgba(255,255,255,0.34)', 'stroke-width': '1.4',
        }));
        heldG.appendChild(el('path', {
          d: badge.path, fill: badge.glyphColor || '#FFFFFF',
          transform: 'translate(-12 -18) scale(1)',
        }));
        /* 双色品牌（XRK 的花瓣 + 金色水滴）：第二条 path 叠在同一坐标系上。
         * 单色牌没有 accent，这里不产生任何额外节点。 */
        if (badge.accent) {
          heldG.appendChild(el('path', {
            d: badge.accent, fill: badge.accentColor || badge.glyphColor || '#FFFFFF',
            transform: 'translate(-12 -18) scale(1)',
          }));
        }
        return;
      }
      if (kind === 'flower') {
        heldG.appendChild(el('circle', { cx: '0', cy: '-8', r: '5.2', fill: '#F4A0B4' }));
        heldG.appendChild(el('circle', { cx: '-7.5', cy: '-3', r: '5.2', fill: '#E07090' }));
        heldG.appendChild(el('circle', { cx: '7.5', cy: '-3', r: '5.2', fill: '#E07090' }));
        heldG.appendChild(el('circle', { cx: '-4.5', cy: '5', r: '5.2', fill: '#E07090' }));
        heldG.appendChild(el('circle', { cx: '4.5', cy: '5', r: '5.2', fill: '#E07090' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '0', r: '4', fill: '#E8C46A' }));
        heldG.appendChild(el('path', {
          d: 'M0 4 v14', fill: 'none', stroke: '#6A9A68', 'stroke-width': '2.4', 'stroke-linecap': 'round',
        }));
        return;
      }
      if (kind === 'tea') {
        heldG.appendChild(el('path', {
          d: 'M-12-4 h22 l-2.2 16.5c-.3 2.2-2.2 3.9-4.4 3.9H-5.4c-2.2 0-4.1-1.7-4.4-3.9Z',
          fill: '#E8D8C8', stroke: '#8A7058', 'stroke-width': '1.8',
        }));
        heldG.appendChild(el('path', {
          d: 'M10-1c5 .6 8 3.4 8 6.6s-3 5.6-8 6.2',
          fill: 'none', stroke: '#8A7058', 'stroke-width': '1.9', 'stroke-linecap': 'round',
        }));
        return;
      }
      if (kind === 'flag') {
        heldG.appendChild(el('path', {
          d: 'M-10-16 v32', fill: 'none', stroke: '#5A6068', 'stroke-width': '2.2', 'stroke-linecap': 'round',
        }));
        heldG.appendChild(el('path', { d: 'M-9-15 l22 8-22 8Z', fill: '#C44868' }));
        return;
      }
      if (kind === 'spark') {
        heldG.appendChild(el('path', {
          fill: '#E8C46A',
          d: 'M0-16 3.4-3.2 16-2 6.4 6.2 9.2 18 0 11.2-9.2 18-6.4 6.2-16-2-3.4-3.2Z',
        }));
        return;
      }
      if (kind === 'book') {
        heldG.appendChild(el('rect', { x: '-13', y: '-10', width: '26', height: '20', rx: '2.4', fill: '#B8506E' }));
        heldG.appendChild(el('rect', { x: '-8.6', y: '-7', width: '18.6', height: '14', rx: '1.6', fill: '#FBF6EC' }));
        heldG.appendChild(el('rect', { x: '-13', y: '-10', width: '5', height: '20', rx: '2.4', fill: '#8A2E48' }));
        heldG.appendChild(el('path', {
          fill: 'none', stroke: '#C8B8A8', 'stroke-width': '1.1', d: 'M-5.5-3.6 h12 M-5.5 0 h12 M-5.5 3.6 h8',
        }));
        return;
      }
      if (kind === 'pencil') {
        heldG.appendChild(el('path', { d: 'M-5-12 h10 v18 l-5 6 -5-6 z', fill: '#E8C46A' }));
        heldG.appendChild(el('path', { d: 'M-5-12 h10 v-3.6 l-5-2.8 -5 2.8 z', fill: '#F2A0B4' }));
        heldG.appendChild(el('path', { d: 'M-5 6 l5 6 5-6 z', fill: '#E8D8C8' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '12', r: '1.6', fill: '#3A3A42' }));
        return;
      }
      if (kind === 'lamp') {
        heldG.appendChild(el('rect', { x: '-4.6', y: '3', width: '9.2', height: '4', rx: '1.6', fill: '#9AA0A8' }));
        heldG.appendChild(el('path', { d: 'M-7 11 h14 l-2.4 4 h-9.2 z', fill: '#7A8088' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '-4', r: '8.6', fill: '#F6E08A' }));
        heldG.appendChild(el('path', {
          fill: 'none', stroke: '#E8C46A', 'stroke-width': '1.4',
          d: 'M-2.6 0 l2.6-5 2.6 5',
        }));
        heldG.appendChild(el('circle', { cx: '-3', cy: '-7', r: '1.8', fill: 'rgba(255,255,255,0.7)' }));
        return;
      }
      if (kind === 'umbrella') {
        heldG.appendChild(el('path', {
          fill: 'none', stroke: '#8A7058', 'stroke-width': '1.9',
          'stroke-linecap': 'round', d: 'M0-13 v6',
        }));
        heldG.appendChild(el('path', { d: 'M-16-2 a16 11 0 0 1 32 0 z', fill: '#6A90C8' }));
        heldG.appendChild(el('path', {
          fill: 'none', stroke: '#8A7058', 'stroke-width': '2',
          'stroke-linecap': 'round', d: 'M0-2 v13 a3.4 3.4 0 0 0 6.8 0',
        }));
        return;
      }
      if (kind === 'icecream') {
        heldG.appendChild(el('path', { d: 'M-8 1 L8 1 L0 18 z', fill: '#E8C46A' }));
        heldG.appendChild(el('path', {
          fill: 'none', stroke: 'rgba(140,100,50,0.45)', 'stroke-width': '1',
          d: 'M-5 5 l7 0 M-3.4 9 l4.8 0',
        }));
        heldG.appendChild(el('circle', { cx: '-4', cy: '-4', r: '6', fill: '#F4A0B4' }));
        heldG.appendChild(el('circle', { cx: '4', cy: '-4', r: '6', fill: '#F6C8D4' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '-9.5', r: '5.6', fill: '#FFF3E0' }));
        return;
      }
      if (kind === 'guitar') {
        heldG.appendChild(el('rect', { x: '-2', y: '-18', width: '4', height: '12', rx: '1.4', fill: '#8A5A32' }));
        heldG.appendChild(el('rect', { x: '-3.4', y: '-19', width: '6.8', height: '3', rx: '1.2', fill: '#6A4222' }));
        heldG.appendChild(el('ellipse', { cx: '0', cy: '-2', rx: '7', ry: '6', fill: '#C4885A' }));
        heldG.appendChild(el('ellipse', { cx: '0', cy: '7', rx: '9.2', ry: '7.6', fill: '#C4885A' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '4.6', r: '2.6', fill: '#3A2A20' }));
        heldG.appendChild(el('path', {
          fill: 'none', stroke: 'rgba(250,240,225,0.7)', 'stroke-width': '0.8', d: 'M-1.2-10 v16 M1.2-10 v16',
        }));
        return;
      }
      if (kind === 'camera') {
        heldG.appendChild(el('rect', { x: '-6', y: '-10.5', width: '12', height: '5', rx: '1.6', fill: '#4A4E56' }));
        heldG.appendChild(el('rect', { x: '-14', y: '-6', width: '28', height: '17.5', rx: '3.4', fill: '#4A4E56' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '2.4', r: '6.6', fill: '#2A2E34' }));
        heldG.appendChild(el('circle', { cx: '0', cy: '2.4', r: '3.4', fill: '#7AB8D8' }));
        heldG.appendChild(el('circle', { cx: '9', cy: '-3', r: '1.7', fill: '#E8C46A' }));
        return;
      }
      if (kind === 'balloon') {
        heldG.appendChild(el('ellipse', { cx: '0', cy: '-5', rx: '9.4', ry: '10.4', fill: '#E07090' }));
        heldG.appendChild(el('path', { d: 'M-2 5.2 h4 l-2 3 z', fill: '#C44868' }));
        heldG.appendChild(el('path', {
          fill: 'none', stroke: '#8A7058', 'stroke-width': '1.3',
          'stroke-linecap': 'round', d: 'M0 8.2 c4 3-4 4.6 0 7.4',
        }));
        heldG.appendChild(el('ellipse', { cx: '-3', cy: '-9', rx: '2.6', ry: '3.4', fill: 'rgba(255,255,255,0.35)' }));
      }
    }

    function rebuildKit() {
      clearKit();
      hatG.removeAttribute('transform');
      specsG.removeAttribute('transform');
      heldG.removeAttribute('transform');
      hatG.style.display = '';
      specsG.style.display = '';
      heldG.style.display = '';
      if (kitHat !== 'none' || hatImage) fillHat(kitHat, hatImage);
      if (isSpecsKit(kitGlasses) || glassesImage) {
        addSpecsPair(specsShapeOf(kitGlasses), glassesImage);
      }
      fillHeld(kitHeld, heldImage);
      paintKit();
    }

    function specSize(slot, other) {
      if (!slot) return { rx: 8, ry: 7 };
      var rx = Math.max(slot.rx || 6, 6) * SPEC_SCALE;
      var ry = Math.max(slot.ry || 5, 5) * SPEC_SCALE * 0.9;
      if (other && other.on && slot.on) {
        var gap = Math.abs((other.x || 0) - (slot.x || 0));
        var maxRx = Math.max(8, (gap - SPEC_BRIDGE) * 0.5);
        if (rx > maxRx) rx = maxRx;
      }
      return { rx: rx, ry: Math.min(ry, rx * 0.92) };
    }

    function layoutSpecsLens(node, slot, other, side) {
      if (!node || !slot) return;
      if (!slot.on || node.getAttribute('data-single') === '1') {
        node.style.display = 'none';
        return;
      }
      node.style.display = '';
      var isSticker = node.getAttribute('data-kit-role') === 'sticker';
      var sz = specSize(slot, other);
      if (isSticker) {
        sz = { rx: sz.rx * STICKER_SPEC_BOOST, ry: sz.ry * STICKER_SPEC_BOOST };
      }
      var tweak = isSticker ? null : SPEC_SHAPE_TWEAK[curSpecShape];
      if (tweak) {
        sz = {
          rx: sz.rx * (tweak.rx || 1) + (tweak.grow || 0),
          ry: sz.ry * (tweak.ry || 1),
        };
      }
      var boxH = tweak && tweak.box ? tweak.box : 1.76;
      var tag = node.tagName.toLowerCase();
      if (tag === 'ellipse') {
        node.setAttribute('cx', r2(slot.x));
        node.setAttribute('cy', r2(slot.y));
        node.setAttribute('rx', r2(sz.rx));
        node.setAttribute('ry', r2(sz.ry));
        return;
      }
      if (tag === 'rect' || tag === 'image' || tag === 'svg') {
        node.setAttribute('x', r2(slot.x - sz.rx));
        node.setAttribute('y', r2(slot.y - sz.ry * (boxH / 2)));
        node.setAttribute('width', r2(sz.rx * 2));
        node.setAttribute('height', r2(sz.ry * boxH));
        return;
      }
      var sx = side < 0 ? -sz.rx : sz.rx;
      node.setAttribute('transform',
        'translate(' + r2(slot.x) + ' ' + r2(slot.y) + ') scale(' + r2(sx) + ' ' + r2(sz.ry) + ')');
    }

    /** A lens still counts as visible only while it has real foreshortened width. */
    function facingSlot(slot) {
      return !!(slot && slot.on && slot.rx > 1.5);
    }

    function layoutGlasses() {
      if (!isSpecsKit(kitGlasses) && !glassesImage) {
        specsG.style.display = 'none';
        return;
      }
      var L = eyeL.slot;
      var R = eyeR.slot;
      var Lvis = facingSlot(L);
      var Rvis = facingSlot(R);
      /* Turned past the silhouette: both lenses are gone, so the glasses SVG goes too. */
      if (!Lvis && !Rvis) {
        specsG.style.display = 'none';
        return;
      }
      if (!Lvis && L) L = { on: false, x: L.x, y: L.y, rx: L.rx, ry: L.ry };
      if (!Rvis && R) R = { on: false, x: R.x, y: R.y, rx: R.rx, ry: R.ry };
      specsG.style.display = '';
      /* 内置椭圆 / 贴纸半幅 image 都走 lens-L/R，每片大小跟该眼 rx·ry。 */
      specsG.removeAttribute('transform');
      layoutSpecsLens(specsG.querySelector('[data-kit="lens-L"]'), L, R, -1);
      layoutSpecsLens(specsG.querySelector('[data-kit="lens-R"]'), R, L, 1);
      var bridge = specsG.querySelector('[data-kit="bridge"]');
      var tL = specsG.querySelector('[data-kit="temple-L"]');
      var tR = specsG.querySelector('[data-kit="temple-R"]');
      if (bridge && L && R && L.on && R.on) {
        var lsz = specSize(L, R);
        var rsz = specSize(R, L);
        var lx = L.x + lsz.rx * 0.96;
        var rx = R.x - rsz.rx * 0.96;
        var my = (L.y + R.y) / 2;
        if (rx - lx < 2) {
          bridge.style.display = 'none';
        } else {
          bridge.setAttribute('d',
            'M' + r2(lx) + ' ' + r2(L.y) + ' Q' + r2((lx + rx) / 2) + ' ' + r2(my - 4) + ' ' + r2(rx) + ' ' + r2(R.y));
          bridge.style.display = '';
        }
      } else if (bridge) {
        bridge.style.display = 'none';
      }
      if (tL && L && L.on) {
        var left = L.x - specSize(L, R).rx;
        tL.setAttribute('d', 'M' + r2(left) + ' ' + r2(L.y) + ' l-10 3.5');
        tL.style.display = '';
      } else if (tL) tL.style.display = 'none';
      if (tR && R && R.on) {
        var right = R.x + specSize(R, L).rx;
        tR.setAttribute('d', 'M' + r2(right) + ' ' + r2(R.y) + ' l10 3.5');
        tR.style.display = '';
      } else if (tR) tR.style.display = 'none';
    }

    function layoutHat() {
      if (kitHat === 'none' && !hatImage) {
        hatG.style.display = 'none';
        return;
      }
      var yaw = lastYaw;
      var cn = Math.cos(yaw);
      var isHalo = kitHat === 'halo';
      /* Halo floats above the crown — keep it through spin/bounce. Solid hats
       * only hide once fully behind the silhouette (still room while |yaw|≈90°). */
      if (!isHalo && cn <= -0.12) {
        hatG.style.display = 'none';
        return;
      }
      hatG.style.display = '';
      var yOff = hatImage
        ? 2
        : (HAT_Y_OFF[kitHat] !== undefined ? HAT_Y_OFF[kitHat] : 0);
      var y = silMinY + yOff;
      var sampleY = Math.min(silMaxY - 4, Math.max(silMinY + 6, y + 14));
      var band = silAt(sampleY);
      var hw = Math.max((band[1] - band[0]) / 2, 14);
      var cx = (band[0] + band[1]) / 2;
      var x = cx + hw * Math.sin(yaw) * (isHalo ? 0.22 : 0.74);
      var cnAbs = Math.abs(cn);
      var sx = isHalo
        ? (0.55 + 0.45 * cnAbs)
        : (0.45 + 0.55 * Math.max(cn, 0));
      var boost = hatImage ? 1 : (HAT_SCALE[kitHat] || 1);
      /* 帽子本体按 54 宽设计（glyph 占据 ±27）。旧式 `hw / 54` 把「帽宽 = 头
       * 半宽」当成目标，实物只有头宽的四分之一，鸭舌/帽檐根本读不出来；
       * 按整条弦宽 2·hw 归一化，帽子才真正扣在脑门上（光环按 72 宽同规格）。 */
      var fit = (hw * 2) / 54 * boost;
      hatG.setAttribute('transform',
        'translate(' + r2(x) + ' ' + r2(y) + ') scale(' + r2(fit * sx) + ' ' + r2(fit) + ')' +
        (isHalo ? ' rotate(-8)' : ''));
    }

    function layoutHeld() {
      if ((kitHeld === 'none' || !kitHeld) && !heldImage) {
        heldG.style.display = 'none';
        return;
      }
      heldG.style.display = '';
      var y = silMinY + (silMaxY - silMinY) * 0.78;
      var band = silAt(y);
      var hw = Math.max((band[1] - band[0]) / 2, 14);
      var cx = (band[0] + band[1]) / 2;
      var x = cx + hw * (0.62 + Math.sin(lastYaw) * 0.18);
      /* 贴纸手持略放大，贴近内置小花视觉体量。 */
      var fit = hw / (heldImage ? 34 : 42);
      heldG.setAttribute('transform',
        'translate(' + r2(x) + ' ' + r2(y) + ') scale(' + r2(fit) + ' ' + r2(fit) + ')');
    }

    function layoutKit() {
      layoutGlasses();
      layoutHat();
      layoutHeld();
    }

    /** Fingerprint eye slots + yaw so kit layout skips unchanged frames. */
    function kitLayoutKey(yaw) {
      var L = eyeL.slot;
      var R = eyeR.slot;
      return (L && L.on ? r2(L.x) + ',' + r2(L.y) + ',' + r2(L.rx) + ',' + r2(L.ry) : '-')
        + '|'
        + (R && R.on ? r2(R.x) + ',' + r2(R.y) + ',' + r2(R.rx) + ',' + r2(R.ry) : '-')
        + '|'
        + r2(yaw || 0);
    }

    function setKit(kind) {
      var split = splitLegacyKit(kind);
      /* legacy 单参入口 = 换回纯内置装扮：三槽贴图一并清掉，
       * 否则上一轮 setDressing 留下的贴图会继续压在新内置件上。 */
      kitHat = split.hat;
      kitGlasses = split.glasses;
      hatImage = '';
      glassesImage = '';
      heldImage = '';
      rebuildKit();
      kitDirty = true;
      layoutKit();
      lastKitKey = kitLayoutKey(lastYaw);
      kitDirty = false;
    }

    function setDressing(hat, glasses, held, image) {
      /* 对象式扩展：setDressing(hat, glasses, held, { hat: url, glasses: url, held: url })。
       * 第四参传字符串 = 旧的 heldImage 调用（只动 held 一槽，保持向后兼容）。 */
      var imgs = (image && typeof image === 'object') ? image : {};
      var legacyHeld = typeof image === 'string' ? image : '';
      kitHat = hat || 'none';
      kitGlasses = glasses || 'none';
      kitHeld = held || 'none';
      hatImage = typeof imgs.hat === 'string' ? imgs.hat : '';
      glassesImage = typeof imgs.glasses === 'string' ? imgs.glasses : '';
      heldImage = legacyHeld || (typeof imgs.held === 'string' ? imgs.held : '');
      rebuildKit();
      kitDirty = true;
      layoutKit();
      lastKitKey = kitLayoutKey(lastYaw);
      kitDirty = false;
    }

    rebuildKit();

    /* ---- 眼睛：轮廓环形变 + 球面投影 ---- */
    function setEye(eye, pose, k, sketch, yaw) {
      /* d 更新：engine 传入插值后的环（引用不变则跳过）。
       * 缩放锚点用当前环自身质心 —— 眼环位置烘焙在数据里（如检索环偏向一侧），
       * 绕默认质心缩放会把位置偏差放大导致眼睛飞出身体 */
      var ring = pose.ring;
      if (ring && ring !== eye.ring) {
        eye.ring = ring;
        eye.node.setAttribute('d', ringPath(ring));
        eye.c = centroid(ring);
      }

      var base = eye.c || BASE_C[k];
      var open = clamp(pose.open, 0.02, 2.4);
      var sy = clamp(pose.scaleY * open * face.eye, 0.02, 2.4);
      var sxBase = pose.scaleX * face.eye;

      /* 纵向：脸部拟合映射 + 轮廓钳制 */
      var halfH = EYE_HALF * sy + 2;
      var ey0 = HEAD_C + face.y + (base[1] - HEAD_C) * face.sy + pose.y + pose.lookY;
      ey0 = clamp(ey0, silMinY + halfH, silMaxY - halfH);

      var sil = silAt(ey0);
      var cx0 = (sil[0] + sil[1]) / 2;
      var hw = Math.max((sil[1] - sil[0]) / 2, 12);

      /* 横向：经度换算 + 自旋偏航 + 余弦压缩 */
      var ox = face.x + (base[0] - HEAD_C) * face.sx + pose.x + pose.lookX;
      var theta = clamp(ox / hw, -1.15, 1.15);
      var total = theta + (yaw || 0);
      var cn = Math.cos(total);
      if (cn <= 0.02) {
        eye.node.style.display = 'none';
        if (eye.slot) eye.slot.on = false;
        return;
      }
      eye.node.style.display = '';
      var ex = cx0 + hw * Math.sin(total) * 0.985;
      var dyN = (ey0 - HEAD_C) / 130;
      var fy = Math.sqrt(1 - dyN * dyN * 0.22);
      eye.slot = {
        on: true,
        x: ex,
        y: ey0,
        rx: EYE_HALF * sxBase * cn * 0.72,
        ry: EYE_HALF * sy * fy * 0.72,
      };

      eye.node.setAttribute('transform',
        'translate(' + r2(ex) + ' ' + r2(ey0) + ')' +
        (pose.rotate ? ' rotate(' + r2(pose.rotate) + ')' : '') +
        ' scale(' + r2(sxBase * cn) + ' ' + r2(sy * fy) + ')' +
        ' translate(' + r2(-base[0]) + ' ' + r2(-base[1]) + ')');

      var fill = sketch > 0.5 ? 'none' : pose.color;
      /* 线稿眼描边同样走主题墨色：暗色页面用浅墨，避免深色瞳色几乎不可见 */
      var stroke = sketch > 0.5 ? 'var(--sketch-ink, ' + pose.color + ')' : '';
      if (fill !== eye.lastFill) { eye.node.setAttribute('fill', fill); eye.lastFill = fill; }
      if (stroke !== eye.lastStroke) { eye.node.style.stroke = stroke; eye.lastStroke = stroke; }
    }

    /* ---- 每帧 ---- */
    function applyPose(pose) {
      var b = pose.body;
      var now = performance.now();
      var sketch = b.sketch || 0;

      bodyG.setAttribute('transform',
        'translate(' + r2(HEAD_C + b.x) + ' ' + r2(HEAD_C + b.y) + ')' +
        ' rotate(' + r2(b.rotate || 0) + ')' +
        ' scale(' + r2(b.scale) + ')' +
        ' translate(' + r2(-HEAD_C) + ' ' + r2(-HEAD_C) + ')');
      setBodyColor(b.color);

      if (sketch !== curSketch) {
        curSketch = sketch;
        if (sketch > 0.5) {
          /* 线稿模式：描边优先取页面主题墨色 --sketch-ink（暗色页浅墨、亮色页深墨），
           * 无主题变量时回退体色加深 */
          head.setAttribute('fill', 'none');
          head.style.stroke = 'var(--sketch-ink, ' + shade(b.color, -0.6) + ')';
          head.setAttribute('stroke-opacity', '0.85');
        } else {
          head.setAttribute('fill', 'url(#' + id + 'g)');
          head.style.stroke = '';
        }
      }

      var yaw = b.yaw || 0;
      lastYaw = yaw;
      setEye(eyeL, pose.left, 0, sketch, yaw);
      setEye(eyeR, pose.right, 1, sketch, yaw);
      var nextKitKey = kitLayoutKey(yaw);
      if (kitDirty || nextKitKey !== lastKitKey) {
        lastKitKey = nextKitKey;
        kitDirty = false;
        try { layoutKit(); } catch (_kitErr) { /* keep the body ticking if a kit layout fails */ }
      }

      if (lite) return;

      var dt = prevNow ? clamp((now - prevNow) / 1000, 0.001, 0.05) : 1 / 60;
      prevNow = now;
      /* Main-thread contention (stream paint): skip ribbon/confetti for this frame. */
      if (dt > 1 / 30) {
        prevYaw = yaw;
        return;
      }

      /* ---- zzz 睡眠粒子：三枚字母错峰沿右上方向漂浮，先淡入后淡出 ---- */
      if (zzzNodes) {
        var zOn = (b.zzz || 0) > 0;
        for (var z = 0; z < zzzNodes.length; z++) {
          var znode = zzzNodes[z];
          if (!zOn) {
            if (znode.getAttribute('opacity') !== '0') znode.setAttribute('opacity', '0');
            continue;
          }
          var zp = (now * 0.00033 + z / 3) % 1;
          var zo = (zp < 0.18 ? zp / 0.18 : 1 - (zp - 0.18) / 0.82) * 0.8 * b.zzz;
          znode.setAttribute('opacity', zo.toFixed(3));
          znode.setAttribute('font-size', (12 + zp * 11).toFixed(1));
          znode.setAttribute('transform',
            'translate(' + r2(180 + zp * 34 + 4 * Math.sin(zp * 9)) + ' ' + r2(48 - zp * 42) + ')' +
            ' rotate(' + r2(-10 + zp * 14) + ')');
        }
      }

      /* ---- 自旋角速度（甩带触发源） ---- */
      var dYaw = yaw - prevYaw;
      if (!isFinite(dYaw) || Math.abs(dYaw) > 1.2) dYaw = 0;
      prevYaw = yaw;
      var vel = dYaw / dt;
      var fast = Math.abs(vel) >= 0.9;
      var dir = vel >= 0 ? 1 : -1;

      if (fast && !wasFast) {
        makePlanes();
        spawnAt = [];
        for (var q = 0; q < planeG; q++) spawnAt.push(now + q * rand(55, 105));
      }
      if (!fast) spawnAt.length = 0;
      wasFast = fast;
      if (Math.abs(vel) >= 5) {
        while (spawnAt.length && now >= spawnAt[0]) {
          spawnAt.shift();
          spawnTrail(yaw - rand(0, 0.18) * dir, dir);
        }
      }

      /* ---- 常驻环带补给：状态需要且数量不足时错峰生成 ---- */
      var orbitWant = (b.orbit || 0) > 0;
      if (orbitWant && now >= orbitNextAt) {
        var orbitCount = 0;
        for (var oc = 0; oc < trails.length; oc++) if (trails[oc].orbitMode) orbitCount++;
        if (orbitCount < 2) spawnOrbit(orbitCount);
        orbitNextAt = now + 700;
      }

      /* ---- 彩带逐帧更新 ---- */
      for (var ti = trails.length - 1; ti >= 0; ti--) {
        var rb = trails[ti];
        rb.life += dt;
        var retract = rb.orbitMode ? !orbitWant : (!fast || rb.life > 5);
        rb.ret = clamp(rb.ret + (retract ? dt / 0.5 : -dt / 0.35), 0, 1);
        if (retract && rb.ret >= 1) { removeTrail(ti); continue; }
        var o = rb.o;
        if (rb.orbitMode) {
          /* 环带：匀速环绕，叠加少量自旋跟随 */
          o.lam += o.lamVel * dt + dYaw * o.follow;
        } else if (fast) {
          o.carry = vel * o.follow;
          o.lam += dYaw * o.follow + o.lamVel * dt;
        } else {
          o.lam += (o.carry + o.lamVel) * dt;
          o.carry *= Math.exp(-2.6 * dt);
          o.lamVel *= Math.exp(-2.6 * dt);
        }
        o.rad += o.radVel * dt;

        var hist = rb.hist;
        var lastL = hist.length ? hist[hist.length - 1].l : o.lam - 0.001 * dir;
        var dl = o.lam - lastL;
        var steps = Math.min(Math.ceil(Math.abs(dl) / 0.09), 24);
        for (var st = 1; st <= steps; st++) hist.push(orbitPoint(o, lastL + dl * st / steps));
        if (!hist.length) hist.push(orbitPoint(o, o.lam));

        /* 回缩：smoothstep 弧长收窄 + 首点插值细修 + 上限 48 点 */
        var span = o.arc * (1 - rb.ret * rb.ret * (3 - 2 * rb.ret));
        while (hist.length > 2 && Math.abs(o.lam - hist[0].l) > span) hist.shift();
        var over = Math.abs(o.lam - hist[0].l) - span;
        if (hist.length >= 2 && over > 0) {
          var tl = hist[0].l + (o.lam - hist[0].l >= 0 ? 1 : -1) * over;
          hist[0] = orbitPoint(o, tl);
        }
        if (hist.length > 48) hist.splice(0, hist.length - 48);

        var zHead = Math.cos(o.lam) * Math.cos(o.tilt);
        var pz = 0.72 + 0.28 * clamp(zHead, 0, 1);
        var grow = Math.min(rb.life / 0.34, 1);
        grow = grow * grow * (3 - 2 * grow);
        var width = rb.r * pz * 1.7 * grow * (1 - 0.72 * rb.ret * rb.ret);
        var fade = Math.min(rb.life / 0.26, 1).toFixed(3);

        if (hist.length < 2 || width < 0.5) {
          rb.back.setAttribute('opacity', '0');
          rb.front.setAttribute('opacity', '0');
          continue;
        }
        var dstr = buildTrail(hist, width);
        rb.back.setAttribute('d', dstr.back);
        rb.front.setAttribute('d', dstr.front);
        rb.back.setAttribute('opacity', fade);
        rb.front.setAttribute('opacity', fade);

        /* 5-stop 色相漂移渐变，端点跟随拖尾首尾 */
        var hue = rb.hue + rb.hueVel * rb.life;
        for (var si = 0; si < rb.stops.length; si++) {
          var frac = si / (rb.stops.length - 1);
          var hv = hue + frac * rb.hueSpan;
          rb.stops[si].setAttribute('stop-color',
            'hsl(' + (((hv % 360) + 360) % 360).toFixed(0) + ' 56% ' + (56 + 11 * frac).toFixed(0) + '%)');
        }
        var tail = hist[0], headP = hist[hist.length - 1];
        rb.gradEl.setAttribute('x1', tail.x.toFixed(1));
        rb.gradEl.setAttribute('y1', tail.y.toFixed(1));
        rb.gradEl.setAttribute('x2', headP.x.toFixed(1));
        rb.gradEl.setAttribute('y2', headP.y.toFixed(1));
      }

      /* ---- 撒花更新：速度衰减 0.94^60dt + 微重力 40/s ---- */
      for (var ci = confPieces.length - 1; ci >= 0; ci--) {
        var pc = confPieces[ci];
        pc.life += dt;
        if (pc.life >= pc.max) {
          pc.el.remove();
          confPieces.splice(ci, 1);
          continue;
        }
        pc.x += pc.vx * dt;
        pc.y += pc.vy * dt;
        var drag = Math.pow(0.94, 60 * dt);
        pc.vx *= drag;
        pc.vy = pc.vy * drag + 40 * dt;
        pc.rot += pc.vr * dt;
        var u = pc.life / pc.max;
        var fd = u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 1.7);
        var sz = Math.max(pc.r * (1 - 0.4 * u), 0.5);
        pc.el.setAttribute('opacity', fd.toFixed(3));
        pc.el.setAttribute('transform',
          'translate(' + r2(pc.x) + ' ' + r2(pc.y) + ') rotate(' + r2(pc.rot) + ') scale(' + r2(sz) + ' ' + r2(sz * pc.stretch) + ')');
      }
    }

    function destroy() {
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    }

    return {
      svg: svg,
      applyPose: applyPose,
      burst: burst,
      setKit: setKit,
      setDressing: setDressing,
      setLite: setLite,
      destroy: destroy,
    };
  }

  EB.createBall = createBall;
})();
