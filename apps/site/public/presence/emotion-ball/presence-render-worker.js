/* ============================================================
 * presence-render-worker.js —— shared render thread for all sessions
 *
 * One Worker owns every OffscreenCanvas ball. Sessions never share
 * engine state; the shared rAF ticker in engine.js advances them.
 * Main thread only posts fire-and-forget commands (no await).
 * ============================================================ */
/* eslint-disable no-undef */
'use strict';

var SCRIPT_BASE = (function () {
  try {
    return new URL('.', self.location.href).href;
  } catch (_e) {
    return '/presence/emotion-ball/';
  }
})();

importScripts(
  SCRIPT_BASE + 'rings.js',
  SCRIPT_BASE + 'emotions.js',
  SCRIPT_BASE + 'canvas-ball.js',
  SCRIPT_BASE + 'engine.js',
);

var engines = new Map();

function emit(id, evt, payload) {
  try {
    self.postMessage({ type: 'event', id: id, evt: evt, payload: payload || null });
  } catch (_e) { /* closed */ }
}

function createEngine(id, canvas, opts) {
  var prev = engines.get(id);
  if (prev) {
    try { prev.destroy(); } catch (_e) { /* ignore */ }
    engines.delete(id);
  }
  try {
    var engine = globalThis.EmotionBall.create(canvas, opts || {});
    engine.on('change', function (payload) { emit(id, 'change', payload); });
    engine.on('tips', function (payload) { emit(id, 'tips', payload); });
    engine.on('error', function (payload) { emit(id, 'error', payload); });
    engines.set(id, engine);
    emit(id, 'ready', { ok: true });
  } catch (err) {
    engines.delete(id);
    emit(id, 'fatal', {
      message: err && err.message ? err.message : String(err),
    });
  }
}

self.onmessage = function (ev) {
  var msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  var id = msg.id;

  if (msg.type === 'create') {
    createEngine(id, msg.canvas, msg.opts);
    return;
  }

  var eng = engines.get(id);
  if (!eng) return;

  if (msg.type === 'destroy') {
    try { eng.destroy(); } catch (_e) { /* ignore */ }
    engines.delete(id);
    return;
  }

  if (msg.type === 'resize') {
    if (eng.ball && eng.ball.resize) eng.ball.resize(msg.cssW, msg.cssH, msg.dpr);
    return;
  }

  if (msg.type !== 'call') return;
  var method = msg.method;
  if (typeof eng[method] !== 'function') return;
  try {
    eng[method].apply(eng, msg.args || []);
  } catch (err) {
    emit(id, 'error', {
      message: err && err.message ? err.message : String(err),
    });
  }
};
