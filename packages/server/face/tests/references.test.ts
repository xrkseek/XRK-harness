import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { faceMethodFromPath } from "../src/wire/index.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

describe("reference remotes", () => {
  it("claims fileReferences/list and sessionReferenceResolver/candidates", () => {
    expect(faceMethodFromPath("/api/fileReferences/list")).toBe(
      "fileReferences/list",
    );
    expect(faceMethodFromPath("/api/sessionReferenceResolver/candidates")).toBe(
      "sessionReferenceResolver/candidates",
    );
  });

  it("lists workspace files and peer session mentions", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xrk-ref-"));
    const readme = path.join(root, "README.md");
    writeFileSync(readme, "# hello\n", "utf8");
    mkdirSync(path.join(root, "notes"), { recursive: true });
    writeFileSync(path.join(root, "notes", "demo.txt"), "demo\n", "utf8");

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      workspaceRoot: root,
      resolveAgent: admittingAgentResolve(store),
    });

    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {
      cwd: root,
    });
    if (!created.result.ok) throw new Error("create primary");
    const primary = (created.result.value as { sessionId: string }).sessionId;

    const peer = await dispatchFaceMethod(runtime, "session.create", "c2", {
      cwd: root,
    });
    if (!peer.result.ok) throw new Error("create peer");
    const peerId = (peer.result.value as { sessionId: string }).sessionId;

    const files = await dispatchFaceMethod(
      runtime,
      "fileReferences/list",
      "f1",
      { args: { agentId: primary, query: "readme" } },
    );
    expect(files.result.ok).toBe(true);
    if (!files.result.ok) throw new Error("files");
    expect(files.result.value).toEqual([
      { path: "README.md", kind: "file" },
    ]);

    const sessions = await dispatchFaceMethod(
      runtime,
      "sessionReferenceResolver/candidates",
      "s1",
      { args: { agentId: primary, query: peerId.slice(0, 4) } },
    );
    expect(sessions.result.ok).toBe(true);
    if (!sessions.result.ok) throw new Error("sessions");
    const items = sessions.result.value as {
      sessionId: string;
      label: string;
      mention: string;
    }[];
    expect(items.some((item) => item.sessionId === peerId)).toBe(true);
    expect(items[0]?.mention).toMatch(/^@\[/);
    expect(items[0]?.mention).toContain("dsh-session:");
  });
});
