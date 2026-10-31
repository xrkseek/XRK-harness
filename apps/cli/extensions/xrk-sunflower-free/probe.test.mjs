/**
 * 探针判据回归锁（node:test，插件自包含，不依赖仓里 vitest 的 include 白名单）。
 *
 *   node --test extensions/xrk-sunflower-free/probe.test.mjs
 *
 * 锁住 3 条历史假阳性：
 *   1. 2xx + 空 body（204）被判 available
 *   2. 2xx + 首帧只有 role delta，随后才报额度错 → 首帧就判 available
 *   3. 2xx + 只有 role delta、流结束、一个字没产出 → 判 available
 * 以及 1 条漏判：额度文案不是 `FreeUsageLimit`，而是
 * `You've used today's free messages. They reset at …`。
 */
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { probeOneModel } from "./probe.mjs";

/** @type {import("node:http").Server} */
let server;
let base;

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

function respond(model, res) {
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const stream = () => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
  };

  switch (model) {
    case "no-body":
      // 2xx 但没有任何 body —— 旧版直接判 available。
      res.writeHead(204);
      res.end();
      return;

    case "delta-then-quota-error":
      // 首帧只是 role delta，随后才报额度 —— 旧版在首帧就 available。
      stream();
      res.write(sse({ choices: [{ delta: { role: "assistant" } }] }));
      setTimeout(() => {
        res.write(
          sse({
            type: "error",
            error: {
              type: "FreeUsageLimitError",
              message: "Free usage limit reached.",
            },
          }),
        );
        res.end();
      }, 60);
      return;

    case "delta-then-cursor-quota":
      // 截图上的那套文案：不含 FreeUsageLimit，旧词表命中不了。
      stream();
      res.write(sse({ choices: [{ delta: { role: "assistant" } }] }));
      setTimeout(() => {
        res.write(
          sse({
            type: "error",
            error: {
              message:
                "You've used today's free messages. They reset at 2026年10月30日 08:45.",
            },
          }),
        );
        res.end();
      }, 60);
      return;

    case "delta-only-eof":
      // 只有 role delta，没有 content、没有终止帧。
      stream();
      res.write(sse({ choices: [{ delta: { role: "assistant" } }] }));
      res.end();
      return;

    case "content-no-finish":
      // 有真实内容但没有 [DONE] / finish_reason（有些上游就这样）。
      stream();
      res.write(sse({ choices: [{ delta: { content: "p" } }] }));
      res.end();
      return;

    case "content-then-finish":
      stream();
      res.write(sse({ choices: [{ delta: { role: "assistant" } }] }));
      res.write(sse({ choices: [{ delta: { content: "pong" } }] }));
      res.write(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
      res.end();
      return;

    case "content-finish-empty":
      // 跑完了但一个字没产出 = 软拒绝。
      stream();
      res.write(sse({ choices: [{ delta: {}, finish_reason: "stop" }] }));
      res.end();
      return;

    case "http-429-quota":
      json(429, {
        type: "error",
        error: { type: "FreeUsageLimitError", message: "limit reached" },
      });
      return;

    case "http-402-cursor-quota":
      json(402, {
        error: {
          message:
            "You've used today's free messages. They reset at 2026年10月30日 08:45.",
        },
      });
      return;

    case "http-404":
      json(404, { error: { message: "no such model" } });
      return;

    case "http-500-plain":
      json(500, { message: "boom" });
      return;

    default:
      json(400, { error: { message: `unhandled model ${model}` } });
  }
}

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let model = "";
      try {
        model = JSON.parse(raw || "{}").model ?? "";
      } catch {
        /* ignore */
      }
      respond(model, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const handle = () => ({ url: base, key: "test-key" });

const expectVerdict = async (model, expected) => {
  const verdict = await probeOneModel(handle(), model, 5000);
  assert.equal(verdict, expected, `${model} → ${verdict}, want ${expected}`);
};

test("2xx 空 body 不算可用", () => expectVerdict("no-body", "unknown"));

test("首帧 role delta 之后才报额度错 → throttled", () =>
  expectVerdict("delta-then-quota-error", "throttled"));

test("'used today's free messages' 文案也能认出限流", () =>
  expectVerdict("delta-then-cursor-quota", "throttled"));

test("只有 role delta、无内容无终止帧 → unknown", () =>
  expectVerdict("delta-only-eof", "unknown"));

test("跑完但没有产出内容 → unknown", () =>
  expectVerdict("content-finish-empty", "unknown"));

test("有内容 + finish_reason → available", () =>
  expectVerdict("content-then-finish", "available"));

test("有内容但不发 [DONE]、流自然结束 → available", () =>
  expectVerdict("content-no-finish", "available"));

test("HTTP 429 + FreeUsageLimitError → throttled", () =>
  expectVerdict("http-429-quota", "throttled"));

test("HTTP 402 + 新额度文案 → throttled", () =>
  expectVerdict("http-402-cursor-quota", "throttled"));

test("HTTP 404 → unavailable", () => expectVerdict("http-404", "unavailable"));

test("HTTP 500 无关键词 → unknown", () =>
  expectVerdict("http-500-plain", "unknown"));
