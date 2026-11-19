import { describe, expect, it } from "vitest";
import {
  DESKTOP_GITHUB_UPDATE_MIRROR,
  desktopGithubLatestDownloadBase,
  desktopUpdateFeedStepForMirror,
  orderedDesktopUpdateFeedSteps,
  orderedDesktopUpdateMirrors,
  preferDesktopGithubProxyByTimezone,
  renderDesktopGithubAppUpdateYml,
  rewriteDesktopGithubUrl,
} from "../src/desktop-update-mirrors.js";

describe("desktop update mirrors (phone-aligned)", () => {
  it("prefers proxy in CN/SEA timezone band", () => {
    expect(preferDesktopGithubProxyByTimezone(8 * 60)).toBe(true); // UTC+8
    expect(preferDesktopGithubProxyByTimezone(0)).toBe(false);
    expect(preferDesktopGithubProxyByTimezone(-5 * 60)).toBe(false);
  });

  it("orders accelerators first in CN, GitHub first elsewhere", () => {
    const cn = orderedDesktopUpdateMirrors({ timezoneOffsetMinutes: 8 * 60 });
    expect(cn[0]?.id).toBe("ghfast");
    expect(cn.at(-1)?.id).toBe("github");

    const us = orderedDesktopUpdateMirrors({ timezoneOffsetMinutes: -5 * 60 });
    expect(us[0]?.id).toBe("github");
    expect(us.some((m) => m.id === "ghfast")).toBe(true);
  });

  it("moves preferred mirror to the front", () => {
    const steps = orderedDesktopUpdateFeedSteps({
      timezoneOffsetMinutes: -5 * 60,
      preferredId: "gh-proxy",
    });
    expect(steps[0]?.id).toBe("gh-proxy");
    expect(steps[0]?.kind).toBe("generic");
  });

  it("rewrites github URLs through prefix mirrors", () => {
    const base = desktopGithubLatestDownloadBase();
    expect(base).toBe(
      "https://github.com/xrkseek/XRK-harness/releases/latest/download",
    );
    expect(rewriteDesktopGithubUrl(base, "https://ghfast.top/")).toBe(
      `https://ghfast.top/${base}`,
    );
    const generic = desktopUpdateFeedStepForMirror({
      id: "ghfast",
      label: "ghfast.top",
      prefix: "https://ghfast.top/",
    });
    expect(generic).toMatchObject({
      kind: "generic",
      channel: "nightly",
    });
    if (generic.kind === "generic") {
      expect(generic.url).toContain("ghfast.top/https://github.com/");
      expect(generic.url.endsWith("/releases/latest/download")).toBe(true);
    }
    expect(desktopUpdateFeedStepForMirror(DESKTOP_GITHUB_UPDATE_MIRROR)).toEqual({
      id: "github",
      label: "GitHub",
      kind: "github",
      owner: "xrkseek",
      repo: "XRK-harness",
      channel: "nightly",
    });
  });

  it("renders github app-update.yml", () => {
    const yml = renderDesktopGithubAppUpdateYml();
    expect(yml).toContain("provider: github");
    expect(yml).toContain("owner: xrkseek");
    expect(yml).toContain("repo: XRK-harness");
    expect(yml).toContain("channel: nightly");
  });
});
