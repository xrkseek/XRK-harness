import { describe, expect, it } from "vitest";
import {
  FACE_CONSOLE_BOOT,
  bootInjectScript,
} from "../src/boot-manifest.js";
import { FaceClient } from "../src/face-client.js";

describe("boot-manifest", () => {
  it("inject script sets both boot globals", () => {
    const s = bootInjectScript(FACE_CONSOLE_BOOT);
    expect(s).toContain("__DSH_BOOT__");
    expect(s).toContain("__XRK_BOOT__");
    expect(s).toContain("xrk-face-console");
  });

  it("console boot remains available for ?console=1", () => {
    expect(FACE_CONSOLE_BOOT.rev).toBe("xrk-face-console");
    expect(FACE_CONSOLE_BOOT.entries[0]?.id).toBe("@xrkseek/face-console");
  });
});

describe("FaceClient", () => {
  it("POSTs DeepSeek-native /api/<method>", async () => {
    const calls: string[] = [];
    const client = new FaceClient({
      baseUrl: "http://127.0.0.1:8787",
      apiKey: "k",
      fetch: async (url, init) => {
        calls.push(String(url));
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            type: "server-response",
            rpcId: "x",
            result: { ok: true, value: { version: "t" } },
          }),
          { status: 200 },
        );
      },
    });
    const r = await client.call("host.describe", {});
    expect(r.ok).toBe(true);
    expect(calls[0]).toBe("http://127.0.0.1:8787/api/host.describe");
  });
});
