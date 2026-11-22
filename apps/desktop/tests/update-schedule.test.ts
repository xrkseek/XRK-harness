import { describe, expect, it, vi } from "vitest";
import {
  DesktopUpdateSchedule,
  resolveDesktopUpdateScheduleConfig,
} from "../src/update-schedule.js";
import type { DesktopUpdateState } from "../src/ipc.js";
import { desktopVersionIsNewer } from "../src/update-coordinator.js";
import {
  presentDesktopUpdateCheckDialog,
  publishDesktopUpdateState,
} from "../src/desktop-update-shell.js";
import { resolveDesktopLocale } from "../src/locale.js";

describe("desktopVersionIsNewer", () => {
  it("compares dotted versions", () => {
    expect(desktopVersionIsNewer("1.2.3", "1.2.2")).toBe(true);
    expect(desktopVersionIsNewer("1.2.3", "1.2.3")).toBe(false);
    expect(desktopVersionIsNewer("1.2.3", "1.3.0")).toBe(false);
    expect(desktopVersionIsNewer("2.0.0-rc.1", "1.9.9")).toBe(true);
  });
});

describe("resolveDesktopUpdateScheduleConfig", () => {
  it("defaults to 10m interval with capped backoff", () => {
    expect(resolveDesktopUpdateScheduleConfig({})).toEqual({
      intervalMs: 600_000,
      maxBackoffMs: 3_600_000,
      jitter: 0.2,
    });
  });

  it("rejects invalid jitter / backoff", () => {
    expect(() =>
      resolveDesktopUpdateScheduleConfig({
        XRK_DESKTOP_UPDATE_CHECK_JITTER: "2",
      }),
    ).toThrow(/jitter/u);
  });
});

describe("DesktopUpdateSchedule", () => {
  it("forces an immediate check and shares in-flight work", async () => {
    let resolveCheck!: (state: DesktopUpdateState) => void;
    const pending = new Promise<DesktopUpdateState>((resolve) => {
      resolveCheck = resolve;
    });
    const updates = {
      state: { phase: "idle" } as DesktopUpdateState,
      check: vi.fn(async () => pending),
    };
    const schedule = new DesktopUpdateSchedule(
      updates,
      { intervalMs: 60_000, maxBackoffMs: 120_000, jitter: 0 },
      () => 0,
      () => 0,
    );
    const first = schedule.check(true, true);
    const second = schedule.check(false, false);
    resolveCheck({ phase: "available", version: "1.1.0" });
    await expect(first).resolves.toEqual({
      phase: "available",
      version: "1.1.0",
    });
    await expect(second).resolves.toEqual({
      phase: "available",
      version: "1.1.0",
    });
    expect(updates.check).toHaveBeenCalledOnce();
    schedule.dispose();
  });

  it("shares in-flight work when a manual check joins an automatic one", async () => {
    let resolveCheck!: (state: DesktopUpdateState) => void;
    const pending = new Promise<DesktopUpdateState>((resolve) => {
      resolveCheck = resolve;
    });
    const updates = {
      state: { phase: "idle" } as DesktopUpdateState,
      check: vi.fn(async () => pending),
    };
    const schedule = new DesktopUpdateSchedule(
      updates,
      { intervalMs: 60_000, maxBackoffMs: 120_000, jitter: 0 },
      () => 0,
      () => 0,
    );
    // Auto first (pending set), then manual must join — not start a second check.
    const auto = schedule.check(false, true);
    const manual = schedule.check(true, true);
    resolveCheck({ phase: "idle" });
    await expect(auto).resolves.toEqual({ phase: "idle" });
    await expect(manual).resolves.toEqual({ phase: "idle" });
    expect(updates.check).toHaveBeenCalledOnce();
    schedule.dispose();
  });

  it("returns current state when not due", async () => {
    const updates = {
      state: { phase: "idle" } as DesktopUpdateState,
      check: vi.fn(async () => ({ phase: "idle" as const })),
    };
    const schedule = new DesktopUpdateSchedule(
      updates,
      { intervalMs: 60_000, maxBackoffMs: 120_000, jitter: 0 },
      () => 0,
      () => 0,
    );
    // Seed deadline in the future via a successful forced check completion path:
    await schedule.check(false, true);
    updates.check.mockClear();
    await expect(schedule.check(false, false)).resolves.toEqual({
      phase: "idle",
    });
    expect(updates.check).not.toHaveBeenCalled();
    schedule.dispose();
  });
});

describe("desktop update shell helpers", () => {
  it("broadcasts state to live windows only", () => {
    const send = vi.fn();
    const live = {
      isDestroyed: () => false,
      webContents: { send },
    };
    const dead = {
      isDestroyed: () => true,
      webContents: { send: vi.fn() },
    };
    const state = publishDesktopUpdateState([live, dead], {
      phase: "available",
      version: "1.0.1",
    });
    expect(state.phase).toBe("available");
    expect(send).toHaveBeenCalledOnce();
    expect(dead.webContents.send).not.toHaveBeenCalled();
  });

  it("does not offer install while prefetch is still available", async () => {
    const locale = resolveDesktopLocale("en");
    const dialog = {
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    };
    await expect(
      presentDesktopUpdateCheckDialog({
        state: { phase: "available", version: "1.2.0" },
        locale,
        dialog,
      }),
    ).resolves.toBe("dismissed");
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    const options = dialog.showMessageBox.mock.calls[0]?.[1] as {
      buttons: string[];
      message: string;
    };
    expect(options.buttons).toEqual(["OK"]);
    expect(options.message).toMatch(/Downloading update 1\.2\.0/u);
  });

  it("offers install only when the update is ready", async () => {
    const locale = resolveDesktopLocale("en");
    const dialog = {
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    };
    await expect(
      presentDesktopUpdateCheckDialog({
        state: { phase: "ready", version: "1.2.0", percent: 100 },
        locale,
        dialog,
      }),
    ).resolves.toBe("install");
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    const options = dialog.showMessageBox.mock.calls[0]?.[1] as {
      buttons: string[];
    };
    expect(options.buttons[0]).toMatch(/Install and Restart/u);
  });
});
