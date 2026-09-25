import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExternalAgentSessionRegistry,
  type ExternalAgentLiveSession,
} from "../src/external-agent-runtime.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function fakeLive(kind: "acp" | "app-server", remoteId: string): ExternalAgentLiveSession {
  return {
    kind,
    remoteId,
    isBusy: () => false,
    lastText: () => undefined,
    prompt: async () => "ok",
    interrupt: async () => undefined,
    dispose: () => undefined,
  };
}

describe("ExternalAgentSessionRegistry cold resume sidecar", () => {
  it("persists handles and reports live → cold after detach", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-ext-"));
    temps.push(dir);
    const file = path.join(dir, "external-agent-handles.json");
    const reg = new ExternalAgentSessionRegistry(file);
    reg.attach("child-1", fakeLive("app-server", "thread_abc"), {
      cwd: "/work",
    });
    expect(reg.resumeState("child-1")).toBe("live");
    expect(reg.kind("child-1")).toBe("app-server");
    reg.detach("child-1");
    expect(reg.resumeState("child-1")).toBe("cold");
    expect(reg.getHandle("child-1")?.remoteId).toBe("thread_abc");

    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      handles: { faceSessionId: string; remoteId: string }[];
    };
    expect(raw.handles).toHaveLength(1);

    const reloaded = new ExternalAgentSessionRegistry(file);
    expect(reloaded.resumeState("child-1")).toBe("cold");
    expect(reloaded.getHandle("child-1")?.kind).toBe("app-server");
  });
});
