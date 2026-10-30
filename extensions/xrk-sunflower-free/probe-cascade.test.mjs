/**
 * 出口级联：先直连，失败再用候选代理。
 *
 *   node --test extensions/xrk-sunflower-free/probe-cascade.test.mjs
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProxySetting,
  probeOpenCodeCascade,
} from "./probe-cascade.mjs";

/** @type {typeof fetch | undefined} */
let savedFetch;

afterEach(() => {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
});

function installEgressFetch(onEgress) {
  savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("/__sunflower/egress")) {
      throw new Error(`unexpected fetch ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const applied = onEgress(body.proxy);
    return Response.json({
      proxy: applied === false || applied === null ? null : applied,
    });
  };
}

test("classifyProxySetting: off / auto / url / empty", () => {
  assert.equal(classifyProxySetting("off"), "off");
  assert.equal(classifyProxySetting("0"), "off");
  assert.equal(classifyProxySetting("auto"), "auto");
  assert.equal(classifyProxySetting(""), undefined);
  assert.equal(classifyProxySetting(undefined), undefined);
  assert.equal(
    classifyProxySetting("http://127.0.0.1:7897"),
    "url",
  );
});

test("cascade: direct usable → never touches proxy candidate", async () => {
  const egress = [];
  installEgressFetch((proxy) => {
    egress.push(proxy);
    return proxy === false ? false : proxy;
  });
  let probes = 0;
  const result = await probeOpenCodeCascade(
    { url: "http://127.0.0.1:9/v1", key: "k" },
    ["a", "b"],
    async () => {
      probes += 1;
      return ["a"];
    },
    { XRK_SUNFLOWER_PROXY: "http://127.0.0.1:7897" },
  );
  assert.deepEqual(result, { usable: ["a"], egress: "direct" });
  assert.equal(probes, 1);
  assert.deepEqual(egress, [false]);
});

test("cascade: direct empty + explicit proxy → second probe via URL", async () => {
  const egress = [];
  installEgressFetch((proxy) => {
    egress.push(proxy);
    return proxy === false ? false : proxy;
  });
  let probes = 0;
  const result = await probeOpenCodeCascade(
    { url: "http://127.0.0.1:9/v1", key: "k" },
    ["a"],
    async () => {
      probes += 1;
      return probes === 1 ? [] : ["a"];
    },
    { XRK_SUNFLOWER_PROXY: "http://127.0.0.1:7897" },
  );
  assert.deepEqual(result, {
    usable: ["a"],
    egress: "http://127.0.0.1:7897",
  });
  assert.equal(probes, 2);
  assert.deepEqual(egress, [false, "http://127.0.0.1:7897"]);
});

test("cascade: openCodeProxy=off → no proxy leg after direct empty", async () => {
  const egress = [];
  installEgressFetch((proxy) => {
    egress.push(proxy);
    return false;
  });
  let probes = 0;
  const result = await probeOpenCodeCascade(
    { url: "http://127.0.0.1:9/v1", key: "k" },
    ["a"],
    async () => {
      probes += 1;
      return [];
    },
    { XRK_SUNFLOWER_PROXY: "off" },
  );
  assert.deepEqual(result, { usable: [], egress: "direct" });
  assert.equal(probes, 1);
  assert.deepEqual(egress, [false]);
});

test("cascade: empty setting + auto discover finds nothing → stay direct", async () => {
  const egress = [];
  installEgressFetch((proxy) => {
    egress.push(proxy);
    // auto → sidecar returns null (no loopback proxy)
    return proxy === "auto" ? false : proxy === false ? false : proxy;
  });
  const result = await probeOpenCodeCascade(
    { url: "http://127.0.0.1:9/v1", key: "k" },
    ["a"],
    async () => [],
    {},
  );
  assert.deepEqual(result, { usable: [], egress: "direct" });
  assert.deepEqual(egress, [false, "auto"]);
});
