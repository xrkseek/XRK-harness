/**
 * IM chatKey + session map + admit hook scheduling.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imChatKey,
  isImNewSessionCommand,
} from "../src/dsh-compat/im-chat-key.js";
import {
  bindImSession,
  lookupImSession,
  lookupImSessionBySessionId,
} from "../src/dsh-compat/im-session-map.js";
import {
  ingestImWebhook,
  setImFaceAdmitHook,
} from "../src/dsh-compat/im-messaging-bridge.js";

const temps: string[] = [];

afterEach(() => {
  setImFaceAdmitHook(undefined);
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("imChatKey", () => {
  it("aligns with AGT group / device / private grain", () => {
    expect(imChatKey("weixin", { isGroup: true, group_id: 42 })).toBe(
      "weixin:g:42",
    );
    expect(
      imChatKey("telegram", { isDevice: true, device_id: "d1" }),
    ).toBe("telegram:d:d1");
    expect(imChatKey("discord", { user_id: "u9" })).toBe("discord:p:u9");
    expect(imChatKey("slack", { chatId: "C1" })).toBe("slack:c:C1");
    expect(imChatKey("mock", {}, "bot-a")).toBe("mock:bot:bot-a");
  });

  it("detects /new and 新会话", () => {
    expect(isImNewSessionCommand("/new")).toBe(true);
    expect(isImNewSessionCommand("/new please")).toBe(true);
    expect(isImNewSessionCommand("新会话")).toBe(true);
    expect(isImNewSessionCommand("hello")).toBe(false);
  });
});

describe("im-session-map", () => {
  it("binds and looks up by chatKey / sessionId", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-map-"));
    temps.push(home);
    const row = bindImSession(home, {
      chatKey: "weixin:p:1",
      channel: "weixin",
      sessionId: "im-sess-1",
    });
    expect(row.sessionId).toBe("im-sess-1");
    expect(lookupImSession(home, "weixin:p:1")?.sessionId).toBe("im-sess-1");
    expect(lookupImSessionBySessionId(home, "im-sess-1")?.chatKey).toBe(
      "weixin:p:1",
    );
    const next = bindImSession(home, {
      chatKey: "weixin:p:1",
      channel: "weixin",
      sessionId: "im-sess-2",
    });
    expect(next.sessionId).toBe("im-sess-2");
    expect(lookupImSession(home, "weixin:p:1")?.sessionId).toBe("im-sess-2");
  });
});

describe("ingestImWebhook admit hook", () => {
  it("schedules Face admit after persist", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-im-admit-"));
    temps.push(home);
    const seen: string[] = [];
    setImFaceAdmitHook(async (row) => {
      seen.push(row.text);
    });
    ingestImWebhook(home, "mock", { text: "ping face", user_id: 7 });
    await vi.waitFor(() => {
      expect(seen).toEqual(["ping face"]);
    });
  });
});
