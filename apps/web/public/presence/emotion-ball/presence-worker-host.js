/* ============================================================
 * presence-worker-host.js —— main-thread bridge (EmotionBall.create)
 *
 * Prefer OffscreenCanvas + one shared Worker for every session ball.
 * Commands are postMessage only — never block the UI / RPC path.
 * Falls back to SVG engine.js when OffscreenCanvas is unavailable.
 * ============================================================ */
(function () {
  'use strict';

  var EB = (globalThis.EmotionBall = globalThis.EmotionBall || {});
  var REV = '40';
  var SCRIPT_BASE = '/presence/emotion-ball/';
  var IDLE_MS = 15000;
  var worker = null;
  var nextId = 1;
  var proxies = new Map();
  var legacyLoading = null;
  var idleTimer = 0;
  /** After a render-thread crash, later balls use the SVG engine. */
  var workerDead = false;

  function isImageBitmap(v) {
    return typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;
  }

  /** Workers cannot decode SVG; rasterize stickers on the main thread. */
  function decodeOverlayUrl(url) {
    if (!url || typeof url !== 'string') return Promise.resolve(null);
    if (isImageBitmap(url)) return Promise.resolve(url);
    function viaImage() {
      return new Promise(function (resolve) {
        if (typeof Image === 'undefined') {
          resolve(null);
          return;
        }
        var img = new Image();
        img.onload = function () {
          if (typeof createImageBitmap === 'function') {
            createImageBitmap(img).then(resolve, function () { resolve(null); });
            return;
          }
          resolve(null);
        };
        img.onerror = function () { resolve(null); };
        img.src = url;
      });
    }
    if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') {
      return viaImage();
    }
    return fetch(url).then(function (r) {
      return r.blob();
    }).then(function (b) {
      return createImageBitmap(b);
    }).catch(function () {
      return viaImage();
    });
  }

  function prepareDressingOpts(opts) {
    var base = opts || {};
    return Promise.all([
      decodeOverlayUrl(base.hatImage),
      decodeOverlayUrl(base.glassesImage),
      decodeOverlayUrl(base.heldImage),
    ]).then(function (bitmaps) {
      var next = Object.assign({}, base);
      var transfer = [];
      if (bitmaps[0]) {
        next.hatImage = bitmaps[0];
        if (isImageBitmap(bitmaps[0])) transfer.push(bitmaps[0]);
      }
      if (bitmaps[1]) {
        next.glassesImage = bitmaps[1];
        if (isImageBitmap(bitmaps[1])) transfer.push(bitmaps[1]);
      }
      if (bitmaps[2]) {
        next.heldImage = bitmaps[2];
        if (isImageBitmap(bitmaps[2])) transfer.push(bitmaps[2]);
      }
      return { opts: next, transfer: transfer };
    });
  }

  function canOffscreen() {
    if (workerDead) return false;
    return typeof OffscreenCanvas !== 'undefined'
      && typeof HTMLCanvasElement !== 'undefined'
      && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
      && typeof Worker !== 'undefined';
  }

  function clearIdle() {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = 0;
  }

  function scheduleIdle() {
    clearIdle();
    if (proxies.size > 0 || !worker) return;
    idleTimer = setTimeout(function () {
      idleTimer = 0;
      if (proxies.size > 0 || !worker) return;
      try { worker.terminate(); } catch (_e) { /* ignore */ }
      worker = null;
    }, IDLE_MS);
  }

  function dropProxy(proxy) {
    if (!proxy) return;
    proxies.delete(proxy.id);
    if (proxy._ro) {
      try { proxy._ro.disconnect(); } catch (_e) { /* ignore */ }
      proxy._ro = null;
    }
  }

  function failWorker(err) {
    console.warn('[EmotionBall] render worker failed', err);
    workerDead = true;
    EB.renderBackend = 'svg';
    clearIdle();
    var doomed = Array.from(proxies.values());
    if (worker) {
      try { worker.terminate(); } catch (_e) { /* ignore */ }
      worker = null;
    }
    proxies.clear();
    doomed.forEach(function (proxy) {
      proxy._emit('fatal', {
        message: err && err.message ? err.message : 'render worker failed',
      });
    });
  }

  function ensureWorker() {
    if (workerDead) throw new Error('render worker disabled');
    clearIdle();
    if (worker) return worker;
    worker = new Worker(SCRIPT_BASE + 'presence-render-worker.js?v=' + REV);
    worker.onmessage = function (ev) {
      var msg = ev.data;
      if (!msg || msg.type !== 'event') return;
      var proxy = proxies.get(msg.id);
      if (!proxy) return;
      proxy._emit(msg.evt, msg.payload);
    };
    worker.onerror = function (err) { failWorker(err); };
    worker.onmessageerror = function (err) { failWorker(err); };
    return worker;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(el);
    });
  }

  function loadLegacySvg() {
    if (EB.createSvg) return Promise.resolve();
    if (legacyLoading) return legacyLoading;
    var names = ['rings.js', 'emotions.js', 'ball.js', 'engine.js'];
    var workerCreate = EB.create;
    legacyLoading = names.reduce(function (chain, name) {
      return chain.then(function () {
        return loadScript(SCRIPT_BASE + name + '?v=' + REV);
      });
    }, Promise.resolve()).then(function () {
      if (typeof EB.create !== 'function') {
        throw new Error('EmotionBall SVG engine missing after legacy load');
      }
      /* engine.js overwrote EB.create — park SVG, restore Worker host entry. */
      EB.createSvg = EB.create;
      EB.create = workerCreate;
      legacyLoading = null;
    }, function (err) {
      legacyLoading = null;
      throw err;
    });
    return legacyLoading;
  }

  function WorkerProxy(id, canvas, mount) {
    this.id = id;
    this._events = {};
    this._canvas = canvas;
    this._mount = mount;
    this._ro = null;
    /** Buffer calls until the worker engine emits `ready` (after sticker decode). */
    this._ready = false;
    this._queue = [];
    var self = this;
    if (typeof ResizeObserver !== 'undefined' && mount) {
      this._ro = new ResizeObserver(function () {
        self._postResize();
      });
      this._ro.observe(mount);
    }
  }

  WorkerProxy.prototype._emit = function (evt, payload) {
    if (evt === 'ready' && !this._ready) {
      this._ready = true;
      var queued = this._queue;
      this._queue = [];
      for (var i = 0; i < queued.length; i++) {
        var item = queued[i];
        this._post({
          type: 'call',
          id: this.id,
          method: item.method,
          args: item.args,
        }, item.transfer);
      }
    }
    var list = this._events[evt];
    if (!list) return;
    list.slice().forEach(function (cb) {
      try { cb(payload); } catch (e) { console.error(e); }
    });
  };

  WorkerProxy.prototype.on = function (evt, cb) {
    (this._events[evt] = this._events[evt] || []).push(cb);
    return this;
  };

  WorkerProxy.prototype.off = function (evt, cb) {
    var list = this._events[evt];
    if (!list) return this;
    var i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
    return this;
  };

  /** Fire-and-forget; never respawn a dead/idle worker just to deliver a call. */
  WorkerProxy.prototype._post = function (msg, transfer) {
    if (!worker) return;
    try {
      if (transfer) worker.postMessage(msg, transfer);
      else worker.postMessage(msg);
    } catch (_e) { /* worker gone */ }
  };

  WorkerProxy.prototype._call = function (method, args, transfer) {
    var payload = {
      type: 'call',
      id: this.id,
      method: method,
      args: args || [],
    };
    if (!this._ready) {
      this._queue.push({ method: method, args: args || [], transfer: transfer });
      return;
    }
    this._post(payload, transfer);
  };

  WorkerProxy.prototype._postResize = function () {
    if (!this._mount || !this._canvas) return;
    var rect = this._mount.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this._post({
      type: 'resize',
      id: this.id,
      cssW: Math.max(1, rect.width),
      cssH: Math.max(1, rect.height),
      dpr: dpr,
    });
  };

  WorkerProxy.prototype.setEmotion = function (id, o) {
    this._call('setEmotion', [id, o || {}]);
    return true;
  };
  WorkerProxy.prototype.handleAIMessage = function (msg) {
    this._call('handleAIMessage', [msg]);
    return true;
  };
  WorkerProxy.prototype.setGaze = function (nx, ny) {
    this._call('setGaze', [nx, ny]);
    return this;
  };
  WorkerProxy.prototype.setActive = function (on) {
    this._call('setActive', [!!on]);
  };
  WorkerProxy.prototype.setLite = function (on) {
    this._call('setLite', [!!on]);
    return this;
  };
  WorkerProxy.prototype.spin = function (n, dir) {
    this._call('spin', [n, dir]);
    return this;
  };
  WorkerProxy.prototype.burst = function (n) {
    this._call('burst', [n]);
    return this;
  };
  WorkerProxy.prototype.bounce = function () {
    this._call('bounce', []);
    return this;
  };
  WorkerProxy.prototype.resetIdle = function () {
    this._call('resetIdle', []);
  };
  WorkerProxy.prototype.setKit = function (kit) {
    this._call('setKit', [kit]);
    return this;
  };
  WorkerProxy.prototype.setDressing = function (hat, glasses, held, images) {
    var self = this;
    var imgs = (images && typeof images === 'object') ? images : {};
    var legacyHeld = typeof images === 'string' ? images : '';
    Promise.all([
      decodeOverlayUrl(typeof imgs.hat === 'string' || isImageBitmap(imgs.hat) ? imgs.hat : ''),
      decodeOverlayUrl(typeof imgs.glasses === 'string' || isImageBitmap(imgs.glasses) ? imgs.glasses : ''),
      decodeOverlayUrl(legacyHeld || (typeof imgs.held === 'string' || isImageBitmap(imgs.held) ? imgs.held : '')),
    ]).then(function (bitmaps) {
      if (!proxies.has(self.id)) return;
      var payload = {
        hat: bitmaps[0] || '',
        glasses: bitmaps[1] || '',
        held: bitmaps[2] || '',
      };
      var transfer = [];
      for (var i = 0; i < bitmaps.length; i++) {
        if (isImageBitmap(bitmaps[i])) transfer.push(bitmaps[i]);
      }
      self._call('setDressing', [hat, glasses, held, payload], transfer.length ? transfer : undefined);
    });
    return this;
  };
  WorkerProxy.prototype.destroy = function () {
    dropProxy(this);
    this._post({ type: 'destroy', id: this.id });
    this._events = {};
    this._canvas = null;
    this._mount = null;
    scheduleIdle();
  };

  EB.create = function (target, opts) {
    opts = opts || {};
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('EmotionBall.create：找不到容器元素');

    if (!canOffscreen()) {
      if (typeof EB.createSvg === 'function') return EB.createSvg(el, opts);
      throw new Error('EmotionBall: OffscreenCanvas unavailable and SVG engine not loaded');
    }

    var dpr = window.devicePixelRatio || 1;
    var rect = el.getBoundingClientRect();
    var cssW = Math.max(1, rect.width || 216);
    var cssH = Math.max(1, rect.height || 270);
    var canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', opts.label || 'AI 表情小球');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    el.replaceChildren(canvas);

    var proxy = null;
    try {
      var id = 'ebw' + (nextId++);
      var offscreen = canvas.transferControlToOffscreen();
      proxy = new WorkerProxy(id, canvas, el);
      proxies.set(id, proxy);
      prepareDressingOpts(opts).then(function (prepared) {
        if (!proxies.has(id)) return;
        try {
          ensureWorker().postMessage(
            {
              type: 'create',
              id: id,
              canvas: offscreen,
              opts: Object.assign({}, prepared.opts, { cssW: cssW, cssH: cssH, dpr: dpr }),
            },
            [offscreen].concat(prepared.transfer),
          );
        } catch (err) {
          dropProxy(proxy);
          failWorker(err);
        }
      }, function (err) {
        dropProxy(proxy);
        failWorker(err);
      });
      return proxy;
    } catch (err) {
      dropProxy(proxy);
      failWorker(err);
      el.replaceChildren();
      if (typeof EB.createSvg === 'function') return EB.createSvg(el, opts);
      throw err;
    }
  };

  EB.canOffscreen = canOffscreen;
  EB.loadLegacySvg = loadLegacySvg;
  EB.version = '2.0.0-worker';
  EB.renderBackend = canOffscreen() ? 'worker' : 'svg';
})();
