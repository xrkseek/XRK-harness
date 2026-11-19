import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  accessPinCookieDigest,
  getPhoneBridge,
  normalizePhoneImagePayload,
  requestHasOperator,
  resetPhoneBridgeForTests,
  shaDeviceKey,
} from "../lib/runtime.mjs";
import { PHONE_TOOL_CATALOG } from "../lib/catalog.mjs";
import { materializeBridgePlugins, TOOLS_ID, PROMPT_ID } from "../materialize.mjs";
import { RESULT_BODY_LIMIT } from "../lib/http.mjs";

afterEach(() => {
  resetPhoneBridgeForTests();
  delete globalThis[Symbol.for("xrk.phoneBridge.materialized")];
});

function fakeReq(deviceToken) {
  return {
    headers: {
      cookie: `dsh_ma_device=${encodeURIComponent(deviceToken)}; dsh_ma_session=s`,
    },
  };
}

describe("phone bridge runtime", () => {
  it("catalog has stable phone tool short names", () => {
    const names = PHONE_TOOL_CATALOG.map((t) => t.name);
    expect(names).toContain("apps");
    expect(names).toContain("screen");
    expect(names).toContain("handoff");
    expect(names).toHaveLength(13);
  });

  it("ticket → whitelist → register → invoke → poll → result", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "device-token-aaa";
      const key = shaDeviceKey(device);
      const issued = rt.issueTicket(fakeReq(device), "phone-A");
      expect(issued.ok).toBe(true);
      expect(issued.deviceKey).toBe(key);

      const denied = rt.register(issued.ticket, "phone-A");
      expect(denied.ok).toBe(false);
      expect(denied.error).toBe("not-whitelisted");
      expect(denied.phase).toBe("pending");
      expect(rt.listPending().some((p) => p.deviceKey === key)).toBe(true);
      expect(rt.phaseFor(key)).toBe("pending");
      expect(rt.selfStatus(issued.ticket).phase).toBe("pending");

      rt.addWhitelist(key, "phone-A");
      expect(rt.phaseFor(key)).toBe("allowed");
      const reg = rt.register(issued.ticket, "phone-A");
      expect(reg.ok).toBe(true);
      expect(reg.phase).toBe("allowed");

      rt.bindSession(issued.ticket, "sess-1");

      // Poll first so the bridge is online (register alone does not mark online).
      const pollP = rt.poll(issued.ticket, 5000);
      await new Promise((r) => setTimeout(r, 30));
      const invokeP = rt.invoke("sess-1", "phone_apps", { query: "淘宝" });
      const polled = await pollP;
      expect(polled.ok).toBe(true);
      expect(polled.invokes).toHaveLength(1);
      expect(polled.invokes[0].name).toBe("apps");

      const submitted = rt.submitResult(
        issued.ticket,
        polled.invokes[0].id,
        "淘宝 com.taobao.taobao",
        false,
      );
      expect(submitted.ok).toBe(true);
      const out = await invokeP;
      expect(out.isError).toBe(false);
      expect(out.content).toContain("淘宝");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("invalid-ticket after ticket map wipe (Host restart)", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-wipe-"));
    try {
      const rt = getPhoneBridge(home);
      const deviceToken = "dev-wipe-1";
      const req = {
        headers: { cookie: `dsh_ma_device=${encodeURIComponent(deviceToken)}; dsh_ma_session=s` },
      };
      const issued = rt.issueTicket(req, "phone");
      expect(issued.ok).toBe(true);
      rt.addWhitelist(issued.deviceKey, "wipe");
      expect(rt.register(issued.ticket, "phone").ok).toBe(true);
      // Simulate Host process restart: tickets Map cleared, whitelist persists.
      rt.tickets.clear();
      expect(rt.register(issued.ticket, "phone").error).toBe("invalid-ticket");
      // Fresh ticket on same device cookie still works against whitelist.
      const again = rt.issueTicket(req, "phone");
      expect(again.ok).toBe(true);
      expect(again.deviceKey).toBe(issued.deviceKey);
      expect(rt.register(again.ticket, "phone").ok).toBe(true);
    } finally {
      // temp dir left for OS; no shared state
    }
  });

  it("PIN-only Face tickets with clientDeviceId", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-pin-"));
    try {
      const instanceId = "inst-test";
      const pin = "32010232";
      mkdirSync(join(home, "mobile-access"), { recursive: true });
      // Match Host on-disk shape: { revision, updatedAt, data }.
      writeFileSync(
        join(home, "mobile-access", "state.json"),
        JSON.stringify({
          revision: 1,
          updatedAt: new Date().toISOString(),
          data: {
            instanceId,
            lanToken: pin,
            wanToken: pin,
            sessions: [],
            devices: [],
          },
        }),
        "utf8",
      );
      const rt = getPhoneBridge(home);
      const digest = accessPinCookieDigest(pin, instanceId);
      const req = {
        headers: { cookie: `dsh_ma_wan=${encodeURIComponent(digest)}` },
      };
      const denied = rt.issueTicket(req, "phone");
      expect(denied.ok).toBe(false);
      expect(denied.error).toBe("missing-device-id");

      const issued = rt.issueTicket(req, "phone", "client-stable-id-01");
      expect(issued.ok).toBe(true);
      expect(issued.authVia).toBe("wan-pin");
      expect(issued.deviceKeySource).toBe("client-id");
      expect(issued.deviceKey).toBe(shaDeviceKey("client:client-stable-id-01"));

      const pending = rt.register(issued.ticket, "phone");
      expect(pending.ok).toBe(false);
      expect(pending.phase).toBe("pending");
      expect(rt.listPending()).toHaveLength(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("multi-bridge without bind is ambiguous once both poll", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb2-"));
    try {
      const rt = getPhoneBridge(home);
      const tickets = [];
      for (const tok of ["dev-a", "dev-b"]) {
        const key = shaDeviceKey(tok);
        rt.addWhitelist(key, tok);
        const t = rt.issueTicket(fakeReq(tok));
        rt.register(t.ticket, tok);
        tickets.push(t.ticket);
        // poll marks online (register alone does not)
        void rt.poll(t.ticket, 50);
      }
      await Promise.all(tickets.map((ticket) => rt.poll(ticket, 50)));
      const out = await rt.invoke(undefined, "apps", {});
      expect(out.isError).toBe(true);
      expect(out.content).toMatch(/Multiple phones/i);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("bindSession requires whitelist; removeWhitelist drops session bindings", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-bind-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "bind-dev-1";
      const key = shaDeviceKey(device);
      const issued = rt.issueTicket(fakeReq(device), "phone");
      expect(issued.ok).toBe(true);

      const denied = rt.bindSession(issued.ticket, "sess-pending");
      expect(denied.ok).toBe(false);
      expect(denied.error).toBe("not-whitelisted");

      rt.addWhitelist(key, "phone");
      expect(rt.bindSession(issued.ticket, "sess-ok").ok).toBe(true);
      expect(rt.state.bindings["sess-ok"]).toBe(key);

      expect(rt.removeWhitelist(key)).toBe(true);
      expect(rt.state.bindings["sess-ok"]).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("re-ticket invalidates prior ticket for same device", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-reticket-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "reticket-dev";
      const first = rt.issueTicket(fakeReq(device), "phone");
      const second = rt.issueTicket(fakeReq(device), "phone");
      expect(first.ticket).not.toBe(second.ticket);
      expect(rt.register(first.ticket, "phone").error).toBe("invalid-ticket");
      rt.addWhitelist(second.deviceKey, "phone");
      expect(rt.register(second.ticket, "phone").ok).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("markOffline wakes idle long-poll", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-offline-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "offline-dev";
      const key = shaDeviceKey(device);
      rt.addWhitelist(key, "phone");
      const issued = rt.issueTicket(fakeReq(device), "phone");
      expect(rt.register(issued.ticket, "phone").ok).toBe(true);

      const pollP = rt.poll(issued.ticket, 30_000);
      await new Promise((r) => setTimeout(r, 20));
      expect(rt.markOffline(issued.ticket).ok).toBe(true);
      const polled = await pollP;
      expect(polled.ok).toBe(true);
      expect(polled.invokes).toEqual([]);
      expect(rt.phaseFor(key)).toBe("offline");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("markOffline fails queued invoke without a poll waiter", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-offq-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "offq-dev";
      const key = shaDeviceKey(device);
      rt.addWhitelist(key, "phone");
      const issued = rt.issueTicket(fakeReq(device), "phone");
      rt.register(issued.ticket, "phone");
      await rt.poll(issued.ticket, 30);
      rt.bindSession(issued.ticket, "sess-offq");

      const invokeP = rt.invoke("sess-offq", "phone_apps", {});
      await new Promise((r) => setTimeout(r, 10));
      expect(rt.markOffline(issued.ticket).ok).toBe(true);
      const out = await invokeP;
      expect(out.isError).toBe(true);
      expect(out.content).toMatch(/offline/i);
      expect(rt.phaseFor(key)).toBe("offline");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects invoke when queue is full and App is not polling", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-qfull-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "qfull-dev";
      const key = shaDeviceKey(device);
      rt.addWhitelist(key, "phone");
      const issued = rt.issueTicket(fakeReq(device), "phone");
      rt.register(issued.ticket, "phone");
      // Brief poll marks online, then App "disconnects" without draining.
      await rt.poll(issued.ticket, 30);
      rt.bindSession(issued.ticket, "sess-q");

      const pending = [];
      for (let i = 0; i < 32; i++) {
        pending.push(rt.invoke("sess-q", "phone_apps", { i }));
      }
      await new Promise((r) => setTimeout(r, 10));
      const blocked = await rt.invoke("sess-q", "phone_apps", { i: 99 });
      expect(blocked.isError).toBe(true);
      expect(blocked.content).toMatch(/queue is full/i);

      // Drain + resolve so timers do not leak past the test.
      const drained = await rt.poll(issued.ticket, 50);
      for (const inv of drained.invokes || []) {
        rt.submitResult(issued.ticket, inv.id, "ok", false);
      }
      await Promise.all(pending);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("requestHasOperator rejects bare requests (status gate)", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-op-"));
    try {
      expect(requestHasOperator({ headers: {} }, home).ok).toBe(false);
      expect(
        requestHasOperator(
          { headers: { cookie: "xrk_operator_ui=1" } },
          home,
        ).ok,
      ).toBe(false);
      const device = "op-device-token";
      expect(
        requestHasOperator(
          {
            headers: {
              cookie: `dsh_ma_device=${encodeURIComponent(device)}`,
            },
          },
          home,
        ).ok,
      ).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("normalizePhoneImagePayload strips data-URL and rejects junk", () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
      "base64",
    );
    const ok = normalizePhoneImagePayload(`data:image/png;base64,${pngB64}`, "");
    expect(ok).toEqual({ imageBase64: pngB64, imageMime: "image/png" });
    expect(normalizePhoneImagePayload(pngB64, "image/jpg")?.imageMime).toBe("image/jpeg");
    expect(normalizePhoneImagePayload(pngB64, "text/plain")).toBeNull();
    expect(normalizePhoneImagePayload("", "image/png")).toBeNull();
    expect(RESULT_BODY_LIMIT).toBeGreaterThan(1_048_576);
  });

  it("invoke → result forwards screenshot base64 to the tool caller", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-img-"));
    try {
      const rt = getPhoneBridge(home);
      const device = "device-token-img";
      const key = shaDeviceKey(device);
      const issued = rt.issueTicket(fakeReq(device), "phone-img");
      rt.addWhitelist(key, "phone-img");
      expect(rt.register(issued.ticket, "phone-img").ok).toBe(true);
      rt.bindSession(issued.ticket, "sess-img");

      const pollP = rt.poll(issued.ticket, 5000);
      await new Promise((r) => setTimeout(r, 30));
      const invokeP = rt.invoke("sess-img", "screen", { image: true });
      const polled = await pollP;
      expect(polled.invokes).toHaveLength(1);

      const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
        "base64",
      );
      expect(
        rt.submitResult(
          issued.ticket,
          polled.invokes[0].id,
          "screen text",
          false,
          `data:image/png;base64,${pngB64}`,
          "image/png",
        ).ok,
      ).toBe(true);
      const out = await invokeP;
      expect(out.isError).toBe(false);
      expect(out.content).toContain("screen text");
      expect(out.imageBase64).toBe(pngB64);
      expect(out.imageMime).toBe("image/png");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("materialize writes tools + prompt + settings client + xrk-phone skill", async () => {
    const plugins = mkdtempSync(join(tmpdir(), "xrk-pb-plug-"));
    const home = mkdtempSync(join(tmpdir(), "xrk-pb-home-"));
    try {
      const out = await materializeBridgePlugins({
        pluginsDir: plugins,
        xrkHome: home,
      });
      expect(out.toolsId).toBe(TOOLS_ID);
      expect(out.promptId).toBe(PROMPT_ID);
      expect(out.skillId).toBe("xrk-phone");
      expect(existsSync(join(plugins, TOOLS_ID, "xrk.plugin.json"))).toBe(true);
      expect(existsSync(join(plugins, PROMPT_ID, "plugin.mjs"))).toBe(true);
      expect(existsSync(join(plugins, "web", "plugins", "xrk-phone-bridge", "client.js"))).toBe(
        true,
      );
      expect(existsSync(join(home, "skills", "xrk-phone", "SKILL.md"))).toBe(true);
      const skillBody = readFileSync(join(home, "skills", "xrk-phone", "SKILL.md"), "utf8");
      expect(skillBody).toContain("name: xrk-phone");
      expect(skillBody).toContain("phone_screen");
      expect(skillBody).toContain("本机 guest 与已桥接的远程手机");
      const promptSrc = readFileSync(join(plugins, PROMPT_ID, "plugin.mjs"), "utf8");
      expect(promptSrc).toContain("skill");
      expect(promptSrc).toContain("xrk-phone");
      expect(promptSrc).not.toMatch(/不要.*skill|Host 上不存在/);
      const toolsManifest = JSON.parse(
        readFileSync(join(plugins, TOOLS_ID, "xrk.plugin.json"), "utf8"),
      );
      expect(toolsManifest.kind).toBe("tools");
      const promptManifest = JSON.parse(
        readFileSync(join(plugins, PROMPT_ID, "xrk.plugin.json"), "utf8"),
      );
      expect(promptManifest.kind).toBe("prompt");
    } finally {
      rmSync(plugins, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
