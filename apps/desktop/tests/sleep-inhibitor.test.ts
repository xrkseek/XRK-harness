import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopSleepInhibitor } from "../src/sleep-inhibitor.js";
import {
  preventIdleSleepPrefPath,
  readPreventIdleSleepEnabled,
  readPreventIdleSleepFromSettingsYaml,
  resolvePreventIdleSleepEnabled,
  writePreventIdleSleepEnabled,
} from "../src/prevent-idle-sleep.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("DesktopSleepInhibitor", () => {
  it("acquires only when enabled and a turn is running", () => {
    const start = vi.fn(() => 7);
    const stop = vi.fn(() => true);
    const isStarted = vi.fn(() => true);
    const inhibitor = new DesktopSleepInhibitor({ start, stop, isStarted });

    expect(inhibitor.setEnabled(true).blocking).toBe(false);
    expect(start).not.toHaveBeenCalled();

    expect(inhibitor.setTurnRunning(true).blocking).toBe(true);
    expect(start).toHaveBeenCalledWith("prevent-app-suspension");

    expect(inhibitor.setTurnRunning(false).blocking).toBe(false);
    expect(stop).toHaveBeenCalledWith(7);

    inhibitor.setTurnRunning(true);
    start.mockClear();
    expect(inhibitor.setEnabled(false).blocking).toBe(false);
    expect(stop).toHaveBeenCalled();
  });

  it("dispose releases without requiring another turn edge", () => {
    const start = vi.fn(() => 3);
    const stop = vi.fn(() => true);
    const isStarted = vi.fn(() => true);
    const inhibitor = new DesktopSleepInhibitor({ start, stop, isStarted });
    inhibitor.setEnabled(true);
    inhibitor.setTurnRunning(true);
    inhibitor.dispose();
    expect(stop).toHaveBeenCalledWith(3);
    expect(inhibitor.snapshot().blocking).toBe(false);
  });
});

describe("prevent-idle-sleep pref", () => {
  it("defaults off and round-trips JSON", () => {
    expect(readPreventIdleSleepEnabled(undefined)).toBe(false);
    expect(readPreventIdleSleepEnabled(writePreventIdleSleepEnabled(true))).toBe(
      true,
    );
  });

  it("reads desktop.preventIdleSleep from settings.yaml", () => {
    expect(
      readPreventIdleSleepFromSettingsYaml(`
locale:
  preference: zh-CN
desktop:
  preventIdleSleep: true
  notifyOnComplete: true
`),
    ).toBe(true);
    expect(
      readPreventIdleSleepFromSettingsYaml(`
desktop:
  preventIdleSleep: false
`),
    ).toBe(false);
    expect(readPreventIdleSleepFromSettingsYaml("ui-theme:\n  preference: dark\n")).toBe(
      undefined,
    );
  });

  it("resolves yaml over JSON mirror, else defaults off", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-sleep-"));
    dirs.push(home);
    expect(resolvePreventIdleSleepEnabled(home)).toBe(false);

    writeFileSync(
      preventIdleSleepPrefPath(home),
      writePreventIdleSleepEnabled(true),
    );
    expect(resolvePreventIdleSleepEnabled(home)).toBe(true);

    writeFileSync(
      path.join(home, "settings.yaml"),
      "desktop:\n  preventIdleSleep: false\n",
    );
    expect(resolvePreventIdleSleepEnabled(home)).toBe(false);
    expect(existsSync(preventIdleSleepPrefPath(home))).toBe(true);
  });
});
