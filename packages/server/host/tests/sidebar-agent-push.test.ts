import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  AgentOpenRegistry,
  classifyAgentOpenTarget,
} from "../src/sidebar-agent-opens.js";
import { AgentPtyRegistry, clampDims, snapshotOf } from "../src/sidebar-agent-pty.js";
import { bindSidebarAgentTools, boundBytes } from "../src/sidebar-agent-tools.js";

describe("AgentOpenRegistry", () => {
  it("queues until a view attaches, then consume-on-send", () => {
    const registry = new AgentOpenRegistry();
    const first = registry.enqueue("s1", "file", "/a.ts", "a.ts");
    expect(first.delivered).toBe(false);

    const seen: string[] = [];
    const detach = registry.attach("s1", (req) => {
      seen.push(req.target);
    });
    expect(seen).toEqual(["/a.ts"]);

    const second = registry.enqueue("s1", "url", "https://example.com", "example.com");
    expect(second.delivered).toBe(true);
    expect(seen).toEqual(["/a.ts", "https://example.com"]);

    detach();
    const third = registry.enqueue("s1", "folder", "/w", "w");
    expect(third.delivered).toBe(false);
  });

  it("classifyAgentOpenTarget resolves files and urls", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-agent-open-"));
    const file = path.join(dir, "note.md");
    await writeFile(file, "hi\n", "utf8");
    await expect(classifyAgentOpenTarget(file, dir)).resolves.toMatchObject({
      kind: "file",
      title: "note.md",
    });
    await expect(
      classifyAgentOpenTarget("https://example.com/x", dir),
    ).resolves.toMatchObject({
      kind: "url",
      title: "example.com",
    });
    await expect(classifyAgentOpenTarget(dir, dir)).resolves.toMatchObject({
      kind: "folder",
    });
    await expect(
      classifyAgentOpenTarget(path.join(dir, "missing.txt"), dir),
    ).rejects.toThrow(/does not exist/);
    await expect(classifyAgentOpenTarget("file:///tmp/x", dir)).rejects.toThrow(
      /http/,
    );
  });

  it("flushes every queued open on attach and drops them on drainAll", () => {
    const registry = new AgentOpenRegistry();
    registry.enqueue("s2", "file", "/a", "a");
    registry.enqueue("s2", "folder", "/b", "b");
    const seen: string[] = [];
    registry.attach("s2", (req) => {
      seen.push(req.target);
    });
    expect(seen).toEqual(["/a", "/b"]);

    registry.enqueue("s3", "url", "https://queued.example", "queued");
    registry.drainAll();
    const afterDrain: string[] = [];
    registry.attach("s3", (req) => {
      afterDrain.push(req.target);
    });
    expect(afterDrain).toEqual([]);
  });

  it("sidebar_open queues until a view attaches and honors a disabled editor tab", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-sidebar-open-"));
    const file = path.join(dir, "note.md");
    await writeFile(file, "hi\n", "utf8");
    const registry = new AgentOpenRegistry();
    const tools = createToolRegistry();
    bindSidebarAgentTools(tools, {
      sessionId: "s1",
      agentOpens: registry,
      agentPty: new AgentPtyRegistry(),
      resolveCwd: () => dir,
      readPrefs: () => ({ agentOpenTools: true }),
      readShellOverrides: () => ({}),
    });
    const open = tools.get("sidebar_open");
    expect(open).toBeDefined();
    const queued = await open!.execute({ target: "note.md" });
    const body = JSON.parse(String(queued.content)) as { delivered: boolean };
    expect(body.delivered).toBe(false);

    const seen: string[] = [];
    registry.attach("s1", (req) => {
      seen.push(req.title);
    });
    expect(seen).toEqual(["note.md"]);

    const blocked = createToolRegistry();
    bindSidebarAgentTools(blocked, {
      sessionId: "s1",
      agentOpens: registry,
      agentPty: new AgentPtyRegistry(),
      resolveCwd: () => dir,
      readPrefs: () => ({
        agentOpenTools: true,
        tabsEnabled: { editor: false },
      }),
      readShellOverrides: () => ({}),
    });
    const denied = await blocked.get("sidebar_open")!.execute({ target: file });
    expect(denied.isError).toBe(true);
    expect(String(denied.content)).toMatch(/editor/);
  });
});

describe("AgentPtyRegistry helpers", () => {
  it("clampDims and boundBytes", () => {
    expect(clampDims(1, 9999)).toEqual({ cols: 2, rows: 1024 });
    expect(boundBytes("abcdef", 3)).toEqual({
      text: "abc",
      truncated: true,
    });
  });

  it("list stays empty without creates", () => {
    const registry = new AgentPtyRegistry();
    expect(registry.list("s1")).toEqual([]);
    const listener = vi.fn();
    const unsub = registry.subscribe(listener);
    expect(registry.close("missing")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("snapshotOf omits exit fields while running", () => {
    const snap = snapshotOf({
      uuid: "u1",
      sessionId: "s1",
      title: "t",
      command: "echo",
      cwd: "/w",
      pty: {
        write() {},
        resize() {},
        kill() {},
        onData() {
          return { dispose() {} };
        },
        onExit() {
          return { dispose() {} };
        },
      },
      transcript: "",
      exited: false,
      dataDisposable: { dispose() {} },
      exitDisposable: { dispose() {} },
    });
    expect(snap).toEqual({
      uuid: "u1",
      title: "t",
      command: "echo",
      exited: false,
    });
  });
});
