// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  bindSettingsOpenSection,
  openSettingsSection,
} from "../src/client/settings-nav.ts";

describe("settings-nav", () => {
  it("opens the bound section and clears on unbind", () => {
    const open = vi.fn();
    const dispose = bindSettingsOpenSection(open);
    openSettingsSection("plugins");
    expect(open).toHaveBeenCalledWith("plugins");
    dispose();
    openSettingsSection("models");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ignores blank section ids", () => {
    const open = vi.fn();
    const dispose = bindSettingsOpenSection(open);
    openSettingsSection("   ");
    expect(open).not.toHaveBeenCalled();
    dispose();
  });
});
