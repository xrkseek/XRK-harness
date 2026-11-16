/**
 * Face mux/host WebSocket app-level `: keepalive` (browser idle watchdog feed).
 */
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { WebSocket } from "ws";
import {
  FACE_WS_APP_KEEPALIVE_TEXT,
  createFaceOnlyServer,
} from "../src/index.js";
import { createFaceRuntime } from "../src/runtime.js";

describe("Face WebSocket app keepalive", () => {
  it("emits : keepalive on mux (short test cadence)", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => ({
        admit: async () => ({}) as never,
        pendingAdmits: () => [],
        continueTurn: async () => ({}) as never,
        run: async () => ({}) as never,
        isBusy: () => false,
        abort() {},
        setApprovalHandler() {},
      }),
    });

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) =>
        req.headers.authorization === "Bearer k" ||
        req.headers["x-api-key"] === "k",
      appKeepaliveIntervalMs: 40,
    });
    const { port } = await face.listen();
    const texts: string[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`, {
          headers: { authorization: "Bearer k" },
        });
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for app keepalive")),
          3_000,
        );
        ws.on("message", (data) => {
          const text = String(data);
          texts.push(text);
          if (text === FACE_WS_APP_KEEPALIVE_TEXT) {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        });
        ws.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    } finally {
      await face.close();
    }

    expect(texts).toContain(FACE_WS_APP_KEEPALIVE_TEXT);
  });
});
