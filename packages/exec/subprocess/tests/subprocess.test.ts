import { describe, expect, it } from "vitest";
import { createLocalSubprocess } from "../src/index.js";

const NODE = process.execPath;

/** Child that prints EOF as soon as stdin ends, then exits. */
const STDIN_EOF_SCRIPT =
  "const s=process.stdin;" +
  "if(!s){console.log('EOF');process.exit(0)}" +
  "s.resume();" +
  "s.on('end',()=>{console.log('EOF');process.exit(0)});" +
  "s.on('error',()=>{console.log('EOF');process.exit(0)});";

/** Child that stays alive without producing output. */
const BLOCK_SCRIPT = "setTimeout(()=>{},30000);";

/**
 * Child that spawns a grandchild inheriting its stdio (so the grandchild holds
 * the stdout pipe) and then blocks: killing the child alone leaves the pipe
 * open on POSIX, which is exactly the hang the settle grace must cover.
 */
const ORPHAN_PARENT_SCRIPT =
  "const {spawn}=require('child_process');" +
  `spawn(process.execPath,['-e',${JSON.stringify(BLOCK_SCRIPT)}],{stdio:'inherit'});` +
  "setTimeout(()=>{},30000);";

describe("createLocalSubprocess", () => {
  it("gives stdin-reading commands immediate EOF instead of an open pipe", async () => {
    const subprocess = createLocalSubprocess();
    const result = await subprocess.spawn([NODE, "-e", STDIN_EOF_SCRIPT]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("EOF");
    expect(result.killed).toBe(false);
  });

  it("kills the child when timeoutMs elapses", async () => {
    const subprocess = createLocalSubprocess();
    const result = await subprocess.spawn([NODE, "-e", BLOCK_SCRIPT], {
      timeoutMs: 400,
    });
    expect(result.killed).toBe(true);
    // win32 taskkill /F exits 1; POSIX signals exit null — only `killed` is
    // the cross-platform contract.
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it("kills the child when the abort signal fires", async () => {
    const subprocess = createLocalSubprocess();
    const controller = new AbortController();
    const pending = subprocess.spawn([NODE, "-e", BLOCK_SCRIPT], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    const result = await pending;
    expect(result.killed).toBe(true);
  });

  it(
    "settles a kill even when an orphaned grandchild holds the stdout pipe",
    async () => {
      const subprocess = createLocalSubprocess();
      const handle = subprocess.start([NODE, "-e", ORPHAN_PARENT_SCRIPT]);
      // Let the grandchild inherit the pipe before the stop request.
      await new Promise((resolve) => setTimeout(resolve, 500));
      handle.kill();
      const result = await handle.result();
      expect(result.killed).toBe(true);
    },
    // POSIX settles via the 5s grace; win32 taskkill /T closes the pipe sooner.
    20_000,
  );

  it("tolerates a repeated kill without double-settling", async () => {
    const subprocess = createLocalSubprocess();
    const handle = subprocess.start([NODE, "-e", BLOCK_SCRIPT]);
    handle.kill();
    handle.kill();
    const result = await handle.result();
    expect(result.killed).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it("reports stdout and exit code for a well-behaved child", async () => {
    const subprocess = createLocalSubprocess();
    const result = await subprocess.spawn([
      NODE,
      "-e",
      "console.log('hello');process.exit(3);",
    ]);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(3);
    expect(result.killed).toBe(false);
  });
});
