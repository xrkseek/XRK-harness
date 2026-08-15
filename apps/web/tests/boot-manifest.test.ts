import { describe, expect, it } from "vitest";
import {
  FACE_CONSOLE_BOOT,
  XRK_APP_SHELL_BOOT,
  BOOT_ENTRY_IDS,
  bootInjectScript,
} from "../src/boot-manifest.js";
import { FaceClient } from "../src/face-client.js";

describe("boot-manifest", () => {
  it("inject script sets both boot globals", () => {
    const s = bootInjectScript(XRK_APP_SHELL_BOOT);
    expect(s).toContain("__DSH_BOOT__");
    expect(s).toContain("__XRK_BOOT__");
    expect(s).toContain("xrk-app-shell");
  });

  it("app-shell roster lists connection · face-client · layout-slots", () => {
    expect(XRK_APP_SHELL_BOOT.rev).toBe("xrk-app-shell");
    expect(XRK_APP_SHELL_BOOT.entries.map((e) => e.id)).toEqual(
      BOOT_ENTRY_IDS.map((id) => `@xrkseek/${id}`),
    );
  });

  it("console boot remains available for ?console=1", () => {
    expect(FACE_CONSOLE_BOOT.rev).toBe("xrk-face-console");
    expect(bootInjectScript(FACE_CONSOLE_BOOT)).toContain("xrk-face-console");
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
