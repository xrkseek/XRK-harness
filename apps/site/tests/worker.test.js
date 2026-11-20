import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import catalog from "../releases.json" with { type: "json" };

const env = {
  HARNESS_ORIGIN: "http://127.0.0.1:9",
  ASSETS: { fetch: () => Promise.resolve(new Response("missing", { status: 404 })) },
};

const win = catalog.products.find((row) => row.target === "win-x64");
const android = catalog.products.find((row) => row.target === "android-arm64");
const GH_EXE = `https://github.com/xrkseek/XRK-harness/releases/download/v${win.version}/${win.filename}`;
const GH_APK = `https://github.com/xrkseek/XRK-harness-mobile/releases/download/v${android.version}/${android.filename}`;
const PROXY_EXE = `https://ghfast.top/${GH_EXE}`;
const PROXY_APK = `https://ghfast.top/${GH_APK}`;
const WIN_FILE_RE = new RegExp(
  String(win.filename).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);
const APK_FILE_RE = new RegExp(
  String(android.filename).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

test("non-China default is English with native GitHub download", async () => {
  const req = new Request("https://example.test/");
  Object.defineProperty(req, "cf", { value: { timezone: "America/New_York", country: "US" } });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /lang="en"/);
  assert.match(html, /data-locale-hint="en"/);
  assert.match(html, /data-nav-menu/);
  assert.match(html, /Researcher/);
  assert.match(html, new RegExp(`href="${GH_EXE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, new RegExp(`href="${GH_APK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  // Proxy URL is present for client TZ override, but secondary stays hidden.
  assert.match(html, /ghfast\.top/);
  assert.match(html, /data-dl-secondary[^>]* hidden/);
  assert.doesNotMatch(html, /xrk\.siphot\.com/);
});

test("China timezone is Chinese with mirror primary and GitHub second", async () => {
  const req = new Request("https://example.test/");
  Object.defineProperty(req, "cf", { value: { timezone: "Asia/Shanghai", country: "CN" } });
  const res = await worker.fetch(req, env);
  const html = await res.text();
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /data-locale-hint="zh"/);
  assert.match(html, /调研员/);
  assert.match(html, new RegExp(`href="${PROXY_EXE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, new RegExp(`href="${PROXY_APK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, /镜像加速/);
  assert.match(html, /GitHub 直连/);
  assert.doesNotMatch(html, /data-dl-secondary[^>]* hidden/);
  assert.match(html, WIN_FILE_RE);
  assert.match(html, APK_FILE_RE);
  assert.match(html, /手机/);
  assert.match(html, /Android arm64/);
});

test("explicit lang=en overrides China edge locale copy", async () => {
  const req = new Request("https://example.test/?lang=en");
  Object.defineProperty(req, "cf", { value: { timezone: "Asia/Shanghai", country: "CN" } });
  const res = await worker.fetch(req, env);
  const html = await res.text();
  assert.match(html, /lang="en"/);
  assert.match(html, /Researcher/);
  // CF still China → mirror primary; client TZ may still flip.
  assert.match(html, /ghfast\.top/);
});

test("english query lists desktop and phone groups; mac stays unavailable", async () => {
  const res = await worker.fetch(new Request("https://example.test/?lang=en"), env);
  const html = await res.text();
  assert.match(html, /Researcher/);
  assert.doesNotMatch(html, />调研员</);
  assert.match(html, />Desktop</);
  assert.match(html, />Phone</);
  assert.match(html, /Download Windows/);
  assert.match(html, /Download Android/);
  assert.match(html, /Android arm64/);
  assert.match(html, />macOS</);
  assert.match(html, /Host cold start/);
  assert.match(html, /Open with xrkh web on the command line/);
  assert.match(html, /dl-panel/);
  assert.match(html, /dl-presence/);
  assert.match(html, /id="download"/);
  assert.match(html, /class="chip"/);
  assert.doesNotMatch(html, /download\/mac-/);
  assert.doesNotMatch(html, /macOS Apple Silicon/);
  assert.match(html, /XRK-harness-mobile/);
});

test("mac stays unavailable from releases.json only", async () => {
  const res = await worker.fetch(new Request("https://example.test/?lang=en"), env);
  const html = await res.text();
  assert.match(html, />macOS</);
  assert.match(html, /Open with xrkh web on the command line/);
  assert.doesNotMatch(html, /download\/mac-/);
});

test("Android marketing row comes from releases.json GitHub assets", async () => {
  const res = await worker.fetch(new Request("https://example.test/?lang=en"), env);
  const html = await res.text();
  assert.match(html, new RegExp(`href="${GH_APK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("legacy harness-download API paths are retired (410)", async () => {
  const res = await worker.fetch(
    new Request("https://example.test/api/harness/download/win-x64"),
    env,
  );
  assert.equal(res.status, 410);
  const json = await res.json();
  assert.equal(json.error, "retired");
});

test("operators AGT proxy is retired (410)", async () => {
  const res = await worker.fetch(
    new Request("https://example.test/api/harness/operators"),
    env,
  );
  assert.equal(res.status, 410);
  const json = await res.json();
  assert.equal(json.error, "retired");
});
