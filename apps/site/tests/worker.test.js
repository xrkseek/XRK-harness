import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = {
  HARNESS_ORIGIN: "http://127.0.0.1:9",
  ASSETS: { fetch: () => Promise.resolve(new Response("missing", { status: 404 })) },
};

const GH_EXE =
  "https://github.com/xrkseek/XRK-harness/releases/download/v0.7.0-rc.1/xrk-harness-0.7.0-rc.1-win-x64.exe";
const PROXY_EXE = `https://ghfast.top/${GH_EXE}`;

test("non-China default is English with native GitHub download", async () => {
  const req = new Request("https://example.test/");
  Object.defineProperty(req, "cf", { value: { timezone: "America/New_York", country: "US" } });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /lang="en"/);
  assert.match(html, /data-locale-hint="en"/);
  assert.match(html, /Researcher/);
  assert.match(html, new RegExp(`href="${GH_EXE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
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
  assert.match(html, /镜像加速/);
  assert.match(html, /GitHub 直连/);
  assert.doesNotMatch(html, /data-dl-secondary[^>]* hidden/);
  assert.match(html, /xrk-harness-0\.7\.0-rc\.1-win-x64\.exe/);
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

test("english query and mac stay unavailable", async () => {
  const res = await worker.fetch(new Request("https://example.test/?lang=en"), env);
  const html = await res.text();
  assert.match(html, /Researcher/);
  assert.doesNotMatch(html, />调研员</);
  assert.match(html, /macOS Apple Silicon/);
  assert.match(html, /Host cold start/);
  assert.match(html, /No desktop installer yet/);
  assert.doesNotMatch(html, /download\/mac-/);
});

test("mac stays listed even if the live catalog marks it available", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        products: [
          {
            target: "mac-arm64",
            available: true,
            download: "/api/harness/download/mac-arm64",
          },
        ],
      }),
      { status: 200 },
    );
  try {
    const res = await worker.fetch(new Request("https://example.test/?lang=en"), env);
    const html = await res.text();
    assert.match(html, /macOS Apple Silicon/);
    assert.match(html, /No desktop installer yet/);
    assert.doesNotMatch(html, /download\/mac-/);
  } finally {
    globalThis.fetch = original;
  }
});

test("installer API paths still redirect to AGT update origin", async () => {
  const res = await worker.fetch(
    new Request("https://example.test/api/harness/download/win-x64"),
    { HARNESS_ORIGIN: "http://103.236.89.174:6969" },
  );
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    "http://103.236.89.174:6969/api/harness/download/win-x64",
  );
});
