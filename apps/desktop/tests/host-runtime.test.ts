import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  harnessCliBinBesideHost,
  resolvePackagedDesktopHostRuntime,
  resolveUnpackagedDesktopHostRuntime,
} from "../src/host-runtime.js";
import { DESKTOP_HOST_NODE_ENV } from "../src/host-node.js";

describe("desktop host runtime paths", () => {
  it("resolves packaged resources/host + web + runtime/node + harness-cli", () => {
    const resources = mkdtempSync(join(tmpdir(), "xrk-desktop-res-"));
    mkdirSync(join(resources, "runtime", "node"), { recursive: true });
    mkdirSync(join(resources, "host", "dist"), { recursive: true });
    mkdirSync(
      join(resources, "host", "node_modules", "@xrkseek", "server-host"),
      { recursive: true },
    );
    mkdirSync(join(resources, "web"), { recursive: true });
    writeFileSync(join(resources, "runtime", "node", "node.exe"), "");
    writeFileSync(join(resources, "runtime", "node", "node"), "");
    writeFileSync(join(resources, "host", "dist", "index.js"), "");
    writeFileSync(
      join(
        resources,
        "host",
        "node_modules",
        "@xrkseek",
        "server-host",
        "package.json",
      ),
      "{}",
    );
    writeFileSync(join(resources, "web", "index.html"), "<html></html>");
    mkdirSync(
      join(resources, "host", "node_modules", "@xrkseek", "harness-cli", "dist"),
      { recursive: true },
    );
    writeFileSync(
      join(
        resources,
        "host",
        "node_modules",
        "@xrkseek",
        "harness-cli",
        "dist",
        "bin.js",
      ),
      "",
    );

    const runtime = resolvePackagedDesktopHostRuntime(resources, "win32");
    expect(runtime.entry).toBe(join(resources, "host", "dist", "index.js"));
    expect(runtime.webDist).toBe(join(resources, "web"));
    expect(runtime.nodeExecutable).toContain("node.exe");
    expect(runtime.harnessCliBin).toBe(
      harnessCliBinBesideHost(join(resources, "host")),
    );
  });

  it("refuses packaged Host without bundled harness-cli", () => {
    const resources = mkdtempSync(join(tmpdir(), "xrk-desktop-no-cli-"));
    mkdirSync(join(resources, "runtime", "node"), { recursive: true });
    mkdirSync(join(resources, "host", "dist"), { recursive: true });
    mkdirSync(
      join(resources, "host", "node_modules", "@xrkseek", "server-host"),
      { recursive: true },
    );
    mkdirSync(join(resources, "web"), { recursive: true });
    writeFileSync(join(resources, "runtime", "node", "node.exe"), "");
    writeFileSync(join(resources, "runtime", "node", "node"), "");
    writeFileSync(join(resources, "host", "dist", "index.js"), "");
    writeFileSync(
      join(
        resources,
        "host",
        "node_modules",
        "@xrkseek",
        "server-host",
        "package.json",
      ),
      "{}",
    );
    writeFileSync(join(resources, "web", "index.html"), "<html></html>");

    expect(() =>
      resolvePackagedDesktopHostRuntime(resources, "win32"),
    ).toThrow(/harness-cli missing/);
  });

  it("resolves unpackaged monorepo host when HOST_NODE is set", () => {
    const nodeBin = process.execPath;
    const appRoot = join(process.cwd(), "apps", "desktop");
    const runtime = resolveUnpackagedDesktopHostRuntime({
      desktopAppRoot: appRoot,
      env: { [DESKTOP_HOST_NODE_ENV]: nodeBin },
    });
    expect(runtime.entry).toContain(join("desktop-host", "dist", "index.js"));
    expect(runtime.webDist).toContain(join("web", "dist"));
    expect(runtime.harnessCliBin.length).toBeGreaterThan(0);
  });
});
