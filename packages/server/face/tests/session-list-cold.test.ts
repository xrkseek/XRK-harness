import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

describe("session.list cold rows (Codex tier)", () => {
  it("unloaded sessions use listHints only — no projections fold", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-face-list-cold-"));
    try {
      const store = createPersistentSessionStore(dir, {
        maxResidentSessions: 1,
      });
      const runtime = createBareFaceRuntime({
        store,
        resolveAgent: unusedAgentResolve(),
      });

      const hot = newSession(store);
      store.append(hot.id, {
        type: "turn/start",
        ts: 1,
        turnId: "t-hot",
      });
      store.append(hot.id, {
        type: "user/message",
        ts: 2,
        turnId: "t-hot",
        content: "hot session",
      });

      const cold = newSession(store);
      store.append(cold.id, {
        type: "turn/start",
        ts: 3,
        turnId: "t-cold",
      });
      store.get(cold.id);

      expect(store.isLoaded?.(hot.id)).toBe(false);
      expect(store.isLoaded?.(cold.id)).toBe(true);

      const list = await dispatchFaceMethod(runtime, "session.list", "list", {});
      expect(list.result.ok).toBe(true);
      if (!list.result.ok) throw new Error("list failed");

      const items = (
        list.result.value as {
          items: {
            sessionId: string;
            blank: boolean;
            projections?: unknown;
            title: string | null;
          }[];
        }
      ).items;
      const coldRow = items.find((row) => row.sessionId === hot.id);
      const hotRow = items.find((row) => row.sessionId === cold.id);
      expect(coldRow).toBeDefined();
      expect(hotRow).toBeDefined();
      expect(coldRow!.projections).toBeUndefined();
      expect(coldRow!.title).toBeNull();
      expect(coldRow!.blank).toBe(false);
      expect(hotRow!.projections).toBeDefined();
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
