import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_SPLASH_BG_DARK,
  DESKTOP_SPLASH_BG_LIGHT,
  desktopSplashBackgroundColor,
  readThemePreferenceFromHostSettingsJson,
  readThemePreferenceFromSettingsYaml,
  resolveDesktopColorScheme,
  resolveDesktopThemePreference,
} from "../src/boot-appearance.js";

describe("desktop boot appearance", () => {
  it("parses ui-theme.preference from settings.yaml", () => {
    expect(
      readThemePreferenceFromSettingsYaml(
        "locale:\n  preference: zh\nui-theme:\n  fontSize: 13\n  preference: dark\n",
      ),
    ).toBe("dark");
    expect(
      readThemePreferenceFromSettingsYaml(
        "ui-theme:\n  preference: light\n",
      ),
    ).toBe("light");
    expect(
      readThemePreferenceFromSettingsYaml("ui-theme:\n  fontSize: 13\n"),
    ).toBeUndefined();
  });

  it("parses ui.theme from host-settings.json", () => {
    expect(
      readThemePreferenceFromHostSettingsJson(
        JSON.stringify({ ui: { theme: "dark", locale: "zh" } }),
      ),
    ).toBe("dark");
    expect(readThemePreferenceFromHostSettingsJson("{")).toBeUndefined();
  });

  it("resolves preference from harness home (yaml wins)", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-boot-theme-"));
    writeFileSync(
      join(home, "settings.yaml"),
      "ui-theme:\n  preference: dark\n",
      "utf8",
    );
    writeFileSync(
      join(home, "host-settings.json"),
      JSON.stringify({ ui: { theme: "light" } }),
      "utf8",
    );
    expect(resolveDesktopThemePreference(home)).toBe("dark");
  });

  it("falls back to host-settings then system", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-boot-theme-"));
    mkdirSync(home, { recursive: true });
    expect(resolveDesktopThemePreference(home)).toBe("system");
    writeFileSync(
      join(home, "host-settings.json"),
      JSON.stringify({ ui: { theme: "light" } }),
      "utf8",
    );
    expect(resolveDesktopThemePreference(home)).toBe("light");
  });

  it("maps preference + OS to color scheme and splash floor", () => {
    expect(resolveDesktopColorScheme("dark", false)).toBe("dark");
    expect(resolveDesktopColorScheme("light", true)).toBe("light");
    expect(resolveDesktopColorScheme("system", true)).toBe("dark");
    expect(resolveDesktopColorScheme("system", false)).toBe("light");
    expect(desktopSplashBackgroundColor("dark")).toBe(DESKTOP_SPLASH_BG_DARK);
    expect(desktopSplashBackgroundColor("light")).toBe(DESKTOP_SPLASH_BG_LIGHT);
  });
});
