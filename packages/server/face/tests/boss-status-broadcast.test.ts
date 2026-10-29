import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBossStatusFragmentProvider,
  formatBossStatusInjectBody,
  formatBossStatusUserMessage,
  isBossStatusAudienceSession,
  readBossStatusFields,
  resetBossStatusBroadcastStateForTests,
  scheduleBossStatusBroadcast,
} from "../src/boss-status-broadcast.js";

describe("boss-status-broadcast", () => {
  afterEach(() => {
    resetBossStatusBroadcastStateForTests();
    vi.useRealTimers();
  });

  it("formats mood + tip for employees", () => {
    expect(
      formatBossStatusUserMessage({ moodId: "16", statusLine: "摸鱼中" }),
    ).toBe("[老板状态] 专注 · 摸鱼中");
    expect(formatBossStatusUserMessage({ moodId: "10", statusLine: "" })).toBe(
      "[老板状态] 开心",
    );
    expect(formatBossStatusInjectBody({ moodId: "21", statusLine: "" })).toBe(
      "seat=老板\nmood=生气",
    );
    expect(
      formatBossStatusInjectBody({ moodId: "21", statusLine: "别吵" }),
    ).toBe("seat=老板\nmood=生气\nstatus=别吵");
    expect(
      formatBossStatusUserMessage(
        { moodId: "16", statusLine: "摸鱼中" },
        { boss: "总裁", manager: "主管", agent: "专员" },
      ),
    ).toBe("[总裁状态] 专注 · 摸鱼中");
  });

  it("reads defaults from ui-presence", () => {
    expect(readBossStatusFields({})).toEqual({ moodId: "16", statusLine: "" });
    expect(
      readBossStatusFields({ moodId: " 15 ", statusLine: "  开会中  " }),
    ).toEqual({ moodId: "15", statusLine: "开会中" });
  });

  it("audience includes agent-home identities but skips tool children", () => {
    const runtime = {
      store: { has: (id: string) => id !== "missing" },
      subagents: {
        getByChild: (id: string) => (id === "s-child" ? { mode: "continuable" } : undefined),
      },
      sessionIdentities: {
        get: (id: string) => (id === "s-home" ? { memberId: "mem_x" } : undefined),
      },
    } as never;
    expect(isBossStatusAudienceSession(runtime, "s-office")).toBe(true);
    expect(isBossStatusAudienceSession(runtime, "s-home")).toBe(true);
    expect(isBossStatusAudienceSession(runtime, "s-child")).toBe(false);
    expect(isBossStatusAudienceSession(runtime, "missing")).toBe(false);
  });

  it("turn-start fragment injects live mood for employee sessions", () => {
    const runtime = {
      store: { has: () => true },
      subagents: { getByChild: () => undefined },
      settingsNamespaces: {
        view: () => ({ value: { moodId: "21", statusLine: "别吵" } }),
      },
    } as never;
    const frags = createBossStatusFragmentProvider(runtime).produce({
      sessionId: "s-office",
    });
    expect(frags).toHaveLength(1);
    expect(frags[0]!.text).toContain("<boss_status>");
    expect(frags[0]!.text).toContain("mood=生气");
    expect(frags[0]!.text).toContain("status=别吵");
  });

  it("coalesces rapid Settings writes into one steer for running employees", async () => {
    vi.useFakeTimers();
    const admit = vi.fn();
    const wake = vi.fn();
    const publishQueue = vi.fn();
    const watchSession = vi.fn();
    const runtime = {
      settingsNamespaces: {
        view: () => ({
          value: { moodId: "15", statusLine: "摸鱼中" },
        }),
      },
      store: {
        list: () => ["s-office", "s-home", "s-child", "s-idle"],
        has: (id: string) => id !== "missing",
      },
      subagents: {
        getByChild: (id: string) => (id === "s-child" ? { mode: "continuable" } : undefined),
      },
      sessionIdentities: {
        get: (id: string) => (id === "s-home" ? { memberId: "mem_x" } : undefined),
      },
      drain: {
        isActive: (id: string) => id === "s-office" || id === "s-home" || id === "s-child",
        wake,
      },
      isTurnUiIdle: (id: string) => id === "s-idle" || id === "s-child",
      watchSession,
      resolveAgent: async () => ({ admit }),
      publishQueue,
    } as never;

    scheduleBossStatusBroadcast(
      runtime,
      { moodId: "16", statusLine: "" },
      { moodId: "15", statusLine: "" },
    );
    scheduleBossStatusBroadcast(
      runtime,
      { moodId: "15", statusLine: "" },
      { moodId: "15", statusLine: "摸鱼中" },
    );
    expect(admit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(admit).toHaveBeenCalledTimes(2);
    expect(admit).toHaveBeenCalledWith("[老板状态] 疲惫 · 摸鱼中", {
      delivery: "steer",
    });
    expect(watchSession).toHaveBeenCalledWith("s-office");
    expect(watchSession).toHaveBeenCalledWith("s-home");
    expect(watchSession).not.toHaveBeenCalledWith("s-idle");
    expect(watchSession).not.toHaveBeenCalledWith("s-child");
    expect(wake).toHaveBeenCalledWith("s-office");
    expect(wake).toHaveBeenCalledWith("s-home");
    expect(publishQueue).toHaveBeenCalledWith("s-office");
    expect(publishQueue).toHaveBeenCalledWith("s-home");
  });
});
