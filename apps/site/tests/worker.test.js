import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = {
  HARNESS_ORIGIN: "http://127.0.0.1:9",
  ASSETS: { fetch: () => Promise.resolve(new Response("missing", { status: 404 })) },
};

test("renders product shell, roster, github, and windows download", async () => {
  const res = await worker.fetch(new Request("https://example.test/"), env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /调研员/);
  assert.match(html, /施工员/);
  assert.match(html, /github.com\/xrkseek\/XRK-harness/);
  assert.match(html, /data-theme-id="light"/);
  assert.match(html, /data-theme-id="dark"/);
  assert.match(html, /xrk-harness-0\.5\.14-win-x64\.exe/);
  assert.match(html, /http:\/\/127\.0\.0\.1:9\/api\/harness\/download\/win-x64/);
  assert.match(html, /目前不提供桌面安装包/);
  assert.match(html, /id="play"/);
  assert.match(html, /data-ball/);
  assert.match(html, /presence\/emotion-ball\/engine\.js/);
  assert.match(html, /发版 0\.5\.14/);
  assert.match(html, /修 Host 冷启动/);
  assert.match(html, /发送消息/);
  assert.match(html, /排队（本轮后）/);
  assert.match(html, /插队（本轮结束后）/);
  assert.match(html, /插队中/);
  assert.match(html, /id="delegate-btn"/);
  assert.match(html, /概况/);
  assert.match(html, /委派图/);
  assert.match(html, /命令/);
  assert.match(html, /只读/);
  assert.match(html, /class="primary is-idle"/);
  assert.match(html, /停止生成/);
  assert.match(html, /工作区/);
  assert.match(html, /新建会话/);
  assert.match(html, /class="deskbar"/);
  assert.match(html, /class="hero-ball"/);
  assert.match(html, /class="orbit"/);
  assert.match(html, /蓝圈/);
  assert.match(html, /工作台/);
  assert.match(html, /xrkh web/);
  assert.match(html, /2 \/ 2/);
  assert.doesNotMatch(html, /download\/mac-/);
});

test("english query and mac stay unavailable", async () => {
  const res = await worker.fetch(new Request("https://example.test/?lang=en"), env);
  const html = await res.text();
  assert.match(html, /Researcher/);
  assert.doesNotMatch(html, />调研员</);
  assert.match(html, /macOS Apple Silicon/);
  assert.match(html, /Host cold start/);
  assert.match(html, /Grow toward the sun/);
  assert.match(html, /Send message/);
  assert.match(html, /Commands/);
  assert.match(html, /Read only/);
  assert.match(html, /Queue \(after this turn\)/);
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

test("installer paths redirect off the Worker", async () => {
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
