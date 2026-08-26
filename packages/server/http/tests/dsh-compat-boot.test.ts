import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createXrkDocStore } from "../src/dsh-compat/underlying/doc-store.js";
import {
  bootDshCompatServices,
  shutdownDshCompatServices,
} from "../src/dsh-compat/dsh-compat-boot.js";
import { searchEmbeddedVectorStore } from "../src/dsh-compat/embedded-vector-store.js";

const NOEMA = createXrkDocStore<{ memories: Array<{ id: string; text: string; tags: string[] }> }>(
  ["noema", "memories.json"],
  { memories: [] },
);

describe("dsh-compat-boot", () => {
  const temps: string[] = [];
  const prevWs = process.env.XRK_IM_GATEWAY_WS_URL;

  afterEach(() => {
    shutdownDshCompatServices();
    if (prevWs === undefined) delete process.env.XRK_IM_GATEWAY_WS_URL;
    else process.env.XRK_IM_GATEWAY_WS_URL = prevWs;
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("rebuilds embedded vector index from noema on boot", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-boot-"));
    temps.push(home);
    NOEMA.write(home, {
      memories: [
        { id: "m1", text: "harness vector boot", tags: ["xrkh"] },
      ],
    });
    const boot = await bootDshCompatServices({ xrkHome: home });
    expect(boot.embeddedRows).toBe(1);
    const hits = searchEmbeddedVectorStore(home, "harness vector", 4);
    expect(hits.some((h) => h.id === "m1")).toBe(true);
    boot.close();
  });

  it("starts IM WS client when XRK_IM_GATEWAY_WS_URL is set", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-boot-ws-"));
    temps.push(home);
    delete process.env.XRK_IM_GATEWAY_WS_URL;
    process.env.XRK_IM_GATEWAY_WS_URL = "ws://127.0.0.1:19999/ws";

    class FakeWs {
      readyState = 1;
      close = vi.fn();
      addEventListener = vi.fn();
      send = vi.fn();
    }
    vi.stubGlobal("WebSocket", FakeWs);

    const boot = await bootDshCompatServices({ xrkHome: home });
    expect(boot.imWsStarted).toBe(true);
    boot.close();
  });
});
