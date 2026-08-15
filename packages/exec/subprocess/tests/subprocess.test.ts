import { describe, expect, it } from "vitest";
import { createLocalSubprocess } from "../src/index.js";

describe("LocalSubprocess", () => {
  it("collects stdout and exit code", async () => {
    const sub = createLocalSubprocess();
    const argv =
      process.platform === "win32"
        ? ["cmd.exe", "/c", "echo hello"]
        : ["node", "-e", "process.stdout.write('hello')"];
    const result = await sub.spawn(argv);
    expect(result.stdout.trim()).toContain("hello");
    expect(result.exitCode).toBe(0);
  });

  it("aborts running process", async () => {
    const sub = createLocalSubprocess();
    const ac = new AbortController();
    const argv =
      process.platform === "win32"
        ? ["cmd.exe", "/c", "ping -n 5 127.0.0.1"]
        : ["node", "-e", "setTimeout(()=>{}, 5000)"];
    const p = sub.spawn(argv, { signal: ac.signal, timeoutMs: 2000 });
    setTimeout(() => ac.abort(), 30);
    const result = await p;
    expect(result.killed || result.exitCode !== 0 || result.signal).toBeTruthy();
  });

  it("start returns handle that can be killed", async () => {
    const sub = createLocalSubprocess();
    const argv =
      process.platform === "win32"
        ? ["cmd.exe", "/c", "ping -n 8 127.0.0.1"]
        : ["node", "-e", "setTimeout(()=>{}, 8000)"];
    const handle = sub.start(argv);
    expect(handle.pid).toBeTypeOf("number");
    handle.kill();
    const result = await handle.result();
    expect(result.killed || result.exitCode !== 0 || result.signal).toBeTruthy();
  });
});
