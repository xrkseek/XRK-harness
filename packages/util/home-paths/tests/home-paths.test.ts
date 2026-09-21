import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_XRK_HOME_DISPLAY,
  XRK_HOME_DIR_NAME,
  defaultXrkHome,
  expandHomePath,
  resolveConfiguredXrkHome,
  resolveXrkHome,
  xrkCachePath,
  xrkHomeDisplay,
  xrkHomePath,
} from "../src/index.js";

describe("xrk-home-paths", () => {
  it("defaults to ~/.xrk", () => {
    expect(XRK_HOME_DIR_NAME).toBe(".xrk");
    expect(DEFAULT_XRK_HOME_DISPLAY).toBe("~/.xrk");
    expect(defaultXrkHome()).toBe(path.join(homedir(), ".xrk"));
    expect(resolveXrkHome({})).toBe(path.resolve(defaultXrkHome()));
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePath("~")).toBe(homedir());
    expect(expandHomePath("~/.xrk")).toBe(path.join(homedir(), ".xrk"));
    expect(expandHomePath("~\\.xrk")).toBe(path.join(homedir(), ".xrk"));
    expect(expandHomePath("/tmp/abs")).toBe("/tmp/abs");
  });

  it("honors XRK_HOME over XRK_DSH_HOME / DSH_HOME and expands ~", () => {
    const home = resolveXrkHome({
      XRK_HOME: "~/xrk-home-test",
      XRK_DSH_HOME: "C:/tmp/ignored-dsh",
      DSH_HOME: "C:/tmp/ignored",
    });
    expect(home).toBe(path.resolve(path.join(homedir(), "xrk-home-test")));
  });

  it("falls through empty XRK_HOME to XRK_DSH_HOME then DSH_HOME", () => {
    expect(
      resolveXrkHome({
        XRK_HOME: "  ",
        XRK_DSH_HOME: "C:/tmp/xrk-dsh",
        DSH_HOME: "C:/tmp/dsh",
      }).replace(/\\/g, "/"),
    ).toMatch(/tmp\/xrk-dsh$/);
    expect(
      resolveXrkHome({
        XRK_HOME: "",
        DSH_HOME: "C:/tmp/dsh-only",
      }).replace(/\\/g, "/"),
    ).toMatch(/tmp\/dsh-only$/);
  });

  it("lets an explicit configured path win over env", () => {
    expect(
      resolveConfiguredXrkHome("/tmp/explicit", {
        XRK_HOME: "~/env-xrk",
      }).replace(/\\/g, "/"),
    ).toMatch(/tmp\/explicit$/);
    expect(
      resolveConfiguredXrkHome(undefined, {
        XRK_HOME: "~/env-xrk",
      }),
    ).toBe(path.resolve(path.join(homedir(), "env-xrk")));
  });

  it("joins children and describes display labels", () => {
    const prev = process.env.XRK_HOME;
    try {
      delete process.env.XRK_HOME;
      delete process.env.XRK_DSH_HOME;
      delete process.env.DSH_HOME;
      expect(xrkHomePath("spill")).toBe(
        path.join(resolveXrkHome(), "spill"),
      );
      expect(xrkCachePath("attachments", "request-images")).toBe(
        path.join(resolveXrkHome(), "cache", "attachments", "request-images"),
      );
      expect(xrkCachePath({ xrkHome: "/tmp/explicit" }, "attachments")).toBe(
        path.resolve("/tmp/explicit", "cache", "attachments"),
      );
      expect(xrkHomeDisplay(resolveXrkHome())).toBe("~/.xrk");
      expect(xrkHomeDisplay(path.resolve("/tmp/custom"))).toBe("$XRK_HOME");
    } finally {
      if (prev === undefined) delete process.env.XRK_HOME;
      else process.env.XRK_HOME = prev;
    }
  });
});
