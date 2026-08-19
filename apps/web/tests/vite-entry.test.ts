/** Bare Vite must fail before it can present a bootless shell as a working GUI. */

import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

function viteCli(): string {
  const local = join(WEB_ROOT, "node_modules", "vite", "bin", "vite.js");
  if (existsSync(local)) return local;
  const hoisted = join(WEB_ROOT, "..", "..", "node_modules", "vite", "bin", "vite.js");
  if (existsSync(hoisted)) return hoisted;
  throw new Error("vite CLI not found");
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("port probe returned no address");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    }),
  );
  return address.port;
}

describe("Web development entry", () => {
  it("rejects the package dev alias with the full-host correction", () => {
    const result = spawnSync(process.execPath, [viteCli()], {
      cwd: WEB_ROOT,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("apps/web is not a standalone application");
    expect(result.stderr).toContain("xrk-harness web");
  });

  it("rejects the standalone Vite server with the full-host correction", async () => {
    const probeRoot = mkdtempSync(join(tmpdir(), "xrk-vite-listen-probe-"));
    const marker = join(probeRoot, "listen-called");
    const port = await freePort();
    const probeModule = fileURLToPath(
      new URL("./support/listen-probe.mjs", import.meta.url),
    );
    try {
      const result = spawnSync(
        process.execPath,
        [viteCli(), "--host", "127.0.0.1", "--port", String(port)],
        {
          cwd: WEB_ROOT,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            XRK_LISTEN_PROBE_MARKER: marker,
            NODE_OPTIONS:
              `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(probeModule).href}`.trim(),
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("apps/web is not a standalone application");
      expect(result.stderr).toContain("xrk-harness web");
      expect(result.stderr).toContain("window.__XRK_BOOT__");
      expect(
        existsSync(marker),
        "Vite called Server.listen before rejecting standalone serve mode",
      ).toBe(false);
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  });
});
