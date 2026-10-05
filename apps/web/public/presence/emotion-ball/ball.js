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

  var EB = (window.EmotionBall = window.EmotionBall || {});
  var RD = window.EB_RINGS;
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
    var lite = !!opts.lite;
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

    /* ---- SVG 骨架 ---- */
    var svg = el('svg', {
      viewBox: '-15 -15 259 259',
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': opts.label || 'AI 表情小球'
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
    var heldImage = typeof opts.heldImage === 'string' ? opts.heldImage : '';
    svg.appendChild(bodyG);

    var fxFront = el('g', { 'pointer-events': 'none' });
    svg.appendChild(fxFront);

    /* 眼睛基准中心：默认表情环的质心 */
    var BASE_C = [centroid(EXPR[0][0]), centroid(EXPR[0][1])];

    /* ---- zzz 睡眠粒子：三枚字母沿右上方向循环漂浮 ---- */
    var zzzNodes = null;
    if (!lite) {
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
    var SPEC_BRIDGE = 10;
    var CAT_LENS = 'M-1,0 C-1,-0.82 -0.2,-1.02 0.12,-0.7 C0.82,-1.18 1.18,-0.18 1,0.12 C0.5,0.82 -0.55,0.68 -1,0 Z';

    function parseRgb(hex) {
      var h = String(hex || '#F3F0EA').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      if (!isFinite(n)) return [243, 240, 234];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function kitPalette(body) {
      var rgb = parseRgb(body);
      var L = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      var r = rgb[0], g = rgb[1], b = rgb[2];
      var warm = r > g + 12 && r > b + 8;
      var cool = b >= g && b > r + 8;
      var green = g > r + 8 && g >= b;
      if (L < 0.32) {
        return {
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
      }
      if (warm) {
        return {
          frame: '#4A241C',
          lens: 'rgba(74,36,28,0.11)',
          lensSun: 'rgba(42,22,16,0.56)',
          brim: '#2A1814',
          crown: shade(body, -0.42),
          accent: shade(body, -0.28),
          bow: '#D45A7A',
          knot: '#C44868',
          halo: '#E8B85A',
        };
      }
      if (cool) {
        return {
          frame: '#1E3348',
          lens: 'rgba(30,70,110,0.12)',
          lensSun: 'rgba(16,36,56,0.58)',
          brim: '#152838',
          crown: shade(body, -0.4),
          accent: shade(body, -0.22),
          bow: '#6A90C8',
          knot: '#3A5A8C',
          halo: '#C8D8F0',
        };
      }
      if (green) {
        return {
          frame: '#243828',
          lens: 'rgba(36,72,40,0.12)',
          lensSun: 'rgba(18,40,22,0.55)',
          brim: '#1A2A1C',
          crown: shade(body, -0.4),
          accent: shade(body, -0.22),
          bow: '#E07090',
          knot: '#C44868',
          halo: '#D4E08A',
        };
      }
      return {
        frame: '#2A2A30',
        lens: 'rgba(255,255,255,0.16)',
        lensSun: 'rgba(28,28,32,0.52)',
        brim: '#1A1A20',
        crown: shade(body, -0.35),
        accent: shade(body, -0.22),
        bow: '#E07090',
        knot: '#C44868',
        halo: '#E8C46A',
      };
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

    function clearKit() {
      while (hatG.firstChild) hatG.removeChild(hatG.firstChild);
      while (specsG.firstChild) specsG.removeChild(specsG.firstChild);
      while (heldG.firstChild) heldG.removeChild(heldG.firstChild);
    }

    function paintKit() {
      if ((kitHat === 'none' && kitGlasses === 'none') || !curBodyColor) return;
      var pal = kitPalette(curBodyColor);
      var sun = kitGlasses === 'specs-sun';
      var nodes = bodyG.querySelectorAll('[data-kit-role]');
      var i;
      for (i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var role = node.getAttribute('data-kit-role');
        if (role === 'frame') node.setAttribute('stroke', pal.frame);
        if (role === 'lens') {
          node.setAttribute('fill', sun ? pal.lensSun : pal.lens);
          node.setAttribute('stroke', pal.frame);
        }
        if (role === 'brim') node.setAttribute('fill', pal.brim);
        if (role === 'crown') node.setAttribute('fill', pal.crown);
        if (role === 'accent') node.setAttribute('fill', pal.accent);
        if (role === 'bow') node.setAttribute('fill', pal.bow);
        if (role === 'knot') node.setAttribute('fill', pal.knot);
        if (role === 'halo') node.setAttribute('stroke', pal.halo);
        if (role === 'shine') node.setAttribute('stroke', pal.halo);
      }
    }

    function addSpecsPair(shape) {
      var sw = '4.4';
      if (shape === 'rect') {
        specsG.appendChild(el('rect', {
          'data-kit': 'lens-L', 'data-kit-role': 'lens', fill: palLens(),
          stroke: '#2A2A30', 'stroke-width': sw, rx: '7', ry: '6', opacity: '0.94',
        }));
        specsG.appendChild(el('rect', {
          'data-kit': 'lens-R', 'data-kit-role': 'lens', fill: palLens(),
          stroke: '#2A2A30', 'stroke-width': sw, rx: '7', ry: '6', opacity: '0.94',
        }));
      } else if (shape === 'cat') {
        specsG.appendChild(el('path', {
          'data-kit': 'lens-L', 'data-kit-role': 'lens', d: CAT_LENS, fill: palLens(),
          stroke: '#2A2A30', 'stroke-width': '0.18', opacity: '0.94',
        }));
        specsG.appendChild(el('path', {
          'data-kit': 'lens-R', 'data-kit-role': 'lens', d: CAT_LENS, fill: palLens(),
          stroke: '#2A2A30', 'stroke-width': '0.18', opacity: '0.94',
        }));
      } else {
        specsG.appendChild(el('ellipse', {
          'data-kit': 'lens-L', 'data-kit-role': 'lens', fill: palLens(),
          stroke: '#2A2A30', 'stroke-width': sw, opacity: '0.94',
        }));
        specsG.appendChild(el('ellipse', {
          'data-kit': 'lens-R', 'data-kit-role': 'lens', fill: palLens(),
          stroke: '#2A2A30', 'stroke-width': sw, opacity: '0.94',
        }));
      }
      specsG.appendChild(el('path', {
        'data-kit': 'bridge', 'data-kit-role': 'frame', fill: 'none',
        stroke: '#2A2A30', 'stroke-width': '3.4', 'stroke-linecap': 'round',
      }));
      specsG.appendChild(el('path', {
        'data-kit': 'temple-L', 'data-kit-role': 'frame', fill: 'none',
        stroke: '#2A2A30', 'stroke-width': '3.1', 'stroke-linecap': 'round',
      }));
      specsG.appendChild(el('path', {
        'data-kit': 'temple-R', 'data-kit-role': 'frame', fill: 'none',
        stroke: '#2A2A30', 'stroke-width': '3.1', 'stroke-linecap': 'round',
      }));
    }

    function palLens() {
      return kitGlasses === 'specs-sun' ? 'rgba(28,28,32,0.52)' : 'rgba(255,255,255,0.16)';
    }

    function fillHat(kind) {
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
        hatG.appendChild(el('ellipse', { 'data-kit-role': 'brim', cx: '0', cy: '12', rx: '30', ry: '6' }));
        hatG.appendChild(el('path', { 'data-kit-role': 'crown', d: 'M-21 11c0-17 9.5-28 21-28s21 11 21 28H-21z' }));
        hatG.appendChild(el('path', {
          fill: 'rgba(255,255,255,0.2)',
          d: 'M-8 2c2-8 7-12 8-12 2 0 5 3 7 10-5-2-10-2-15 2z',
        }));
        return;
      }
      if (kind === 'beanie') {
        hatG.appendChild(el('path', { 'data-kit-role': 'crown', d: 'M-22 14c0-18 10-30 22-30s22 12 22 30H-22z' }));
        hatG.appendChild(el('rect', { 'data-kit-role': 'brim', x: '-24', y: '10', width: '48', height: '8', rx: '3' }));
        hatG.appendChild(el('circle', { 'data-kit-role': 'accent', cx: '0', cy: '-14', r: '4.2' }));
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
      }
    }

    function fillHeld(kind, image) {
      if (image) {
        var img = el('image', {
          href: image, x: '-18', y: '-18', width: '36', height: '36',
          preserveAspectRatio: 'xMidYMid meet',
        });
        heldG.appendChild(img);
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
      if (kitHat !== 'none') fillHat(kitHat);
      if (isSpecsKit(kitGlasses)) {
        addSpecsPair(kitGlasses === 'specs-rect' ? 'rect' : kitGlasses === 'specs-cat' ? 'cat' : 'round');
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
      if (!slot.on) {
        node.style.display = 'none';
        return;
      }
      node.style.display = '';
      var sz = specSize(slot, other);
      var tag = node.tagName.toLowerCase();
      if (tag === 'ellipse') {
        node.setAttribute('cx', r2(slot.x));
        node.setAttribute('cy', r2(slot.y));
        node.setAttribute('rx', r2(sz.rx));
        node.setAttribute('ry', r2(sz.ry));
        return;
      }
      if (tag === 'rect') {
        node.setAttribute('x', r2(slot.x - sz.rx));
        node.setAttribute('y', r2(slot.y - sz.ry * 0.88));
        node.setAttribute('width', r2(sz.rx * 2));
        node.setAttribute('height', r2(sz.ry * 1.76));
        return;
      }
      var sx = side < 0 ? -sz.rx : sz.rx;
      node.setAttribute('transform',
        'translate(' + r2(slot.x) + ' ' + r2(slot.y) + ') scale(' + r2(sx) + ' ' + r2(sz.ry) + ')');
    }

    function layoutGlasses() {
      if (!isSpecsKit(kitGlasses)) {
        specsG.style.display = 'none';
        return;
      }
      var L = eyeL.slot;
      var R = eyeR.slot;
      if (!L && !R) {
        specsG.style.display = 'none';
        return;
      }
      specsG.style.display = '';
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
      if (kitHat === 'none') {
        hatG.style.display = 'none';
        return;
      }
      var yaw = lastYaw;
      var cn = Math.cos(yaw);
      if (cn <= 0.08) {
        hatG.style.display = 'none';
        return;
      }
      hatG.style.display = '';
      var yOff = kitHat === 'halo' ? -12 : kitHat === 'visor' ? 16 : kitHat === 'cap' ? 11 : kitHat === 'beanie' ? 8 : 6;
      var y = silMinY + yOff;
      var sampleY = Math.min(silMaxY - 4, Math.max(silMinY + 6, y + 14));
      var band = silAt(sampleY);
      var hw = Math.max((band[1] - band[0]) / 2, 14);
      var cx = (band[0] + band[1]) / 2;
      var x = cx + hw * Math.sin(yaw) * 0.74;
      var sx = 0.4 + 0.6 * cn;
      var fit = hw / 54;
      hatG.setAttribute('transform',
        'translate(' + r2(x) + ' ' + r2(y) + ') scale(' + r2(fit * sx) + ' ' + r2(fit) + ')' +
        (kitHat === 'halo' ? ' rotate(-12)' : ''));
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
      var fit = hw / 42;
      heldG.setAttribute('transform',
        'translate(' + r2(x) + ' ' + r2(y) + ') scale(' + r2(fit) + ' ' + r2(fit) + ')');
    }

    function layoutKit() {
      layoutGlasses();
      layoutHat();
      layoutHeld();
    }

    function setKit(kind) {
      var split = splitLegacyKit(kind);
      kitHat = split.hat;
      kitGlasses = split.glasses;
      rebuildKit();
      layoutKit();
    }

    function setDressing(hat, glasses, held, image) {
      kitHat = hat || 'none';
      kitGlasses = glasses || 'none';
      kitHeld = held || 'none';
      heldImage = typeof image === 'string' ? image : '';
      rebuildKit();
      layoutKit();
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
      try { layoutKit(); } catch (_kitErr) { /* keep the body ticking if a kit layout fails */ }

      if (lite) return;

      var dt = prevNow ? clamp((now - prevNow) / 1000, 0.001, 0.05) : 1 / 60;
      prevNow = now;

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

    return { svg: svg, applyPose: applyPose, burst: burst, setKit: setKit, setDressing: setDressing, destroy: destroy };
  }

  EB.createBall = createBall;
})();
