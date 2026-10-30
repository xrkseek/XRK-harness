/**
 * `plugin add --proxy` must only decorate the one-shot `npm pack` argv —
 * never mutate process.env (Host / other CLI stay unaffected).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(actual.spawnSync),
  };
});

import { fetchPackage } from "../src/plugin/fetch-pack.js";

const temps: string[] = [];

afterEach(() => {
  vi.mocked(spawnSync).mockReset();
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
});

describe("fetchPackage --proxy", () => {
  it("passes --proxy and --https-proxy to npm pack only", () => {
    const stageParent = mkdtempSync(path.join(tmpdir(), "xrk-proxy-pack-"));
    temps.push(stageParent);

    vi.mocked(spawnSync).mockImplementation((cmd, args) => {
      if (cmd === "npm" || (typeof cmd === "string" && cmd.includes("npm"))) {
        // Mimic npm pack writing a tarball into --pack-destination.
        const destIdx = (args as string[]).indexOf("--pack-destination");
        const dest = destIdx >= 0 ? (args as string[])[destIdx + 1]! : stageParent;
        mkdirSync(dest, { recursive: true });
        // Minimal gzip tar with package/package.json — use a real pack via
        // fallback: create empty .tgz that extract will fail; instead short-
        // circuit by packing a local path (no npm). See local-path test.
        writeFileSync(path.join(dest, "noop.tgz"), "");
        return {
          status: 0,
          stdout: "noop.tgz\n",
          stderr: "",
          error: undefined,
          pid: 0,
          output: [null, "noop.tgz\n", ""],
          signal: null,
        } as ReturnType<typeof spawnSync>;
      }
      return {
        status: 1,
        stdout: "",
        stderr: "unexpected",
        error: undefined,
        pid: 0,
        output: [null, "", "unexpected"],
        signal: null,
      } as ReturnType<typeof spawnSync>;
    });

    expect(() =>
      fetchPackage("some-pkg@1.0.0", process.cwd(), {
        proxy: "http://127.0.0.1:7897",
        registry: "https://registry.npmjs.org/",
      }),
    ).toThrow(); // extract fails on empty tgz — argv is what we assert

    const npmCall = vi.mocked(spawnSync).mock.calls.find((c) => {
      const cmd = c[0];
      return cmd === "npm" || (typeof cmd === "string" && cmd.includes("npm"));
    });
    expect(npmCall).toBeDefined();
    const argv = npmCall![1] as string[];
    expect(argv).toContain("--proxy");
    expect(argv).toContain("--https-proxy");
    expect(argv).toContain("http://127.0.0.1:7897");
    expect(argv).toContain("--registry");
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
  });

  it("skips npm entirely for a local package.json path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-local-pkg-"));
    temps.push(dir);
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "local-fixture", version: "0.0.1" }),
    );
    const unpacked = fetchPackage(dir, process.cwd(), {
      proxy: "http://127.0.0.1:7897",
    });
    expect(unpacked.pkg.name).toBe("local-fixture");
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    unpacked.cleanup();
  });
});
