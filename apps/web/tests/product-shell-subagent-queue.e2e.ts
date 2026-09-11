/**
 * Host-serve subagent queue / Steer / Stop soak:
 * 1) Parent QueueDock chrome (queue · Steer · Stop) while a turn hangs
 * 2) Continuable child Face hang → queue → updateQueue steer → interrupt
 * 3) One-shot Face `session.updateQueue` → `subagent-not-resumable`
 *
 * Catalog open UI stays on Cordis `subagent-conversation.e2e` (not this lane).
 *
 * Do not open a second PersistentSessionStore while a turn is open — repair
 * writes race the Host store and trip UNIQUE(session_id, seq).
 */
import { createPersistentSessionStore, toJSONL } from "@xrkseek/core-session";
import type { LlmAdapter, LlmChatRequest, LlmStreamEvent } from "@xrkseek/llm";
import { describe, expect, it } from "vitest";
import {
  HAS_SHELL,
  faceRpc,
  openEnglishPage,
  prepareLiveComposer,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const HANG_PREFIX = "subagent-hang-prefix";
const QUEUED = "queued-follow-up-for-steer";
const AFTER_STOP = "subagent-after-stop-ok";
const CHILD_HANG = "child-hang-until-steer";
const CHILD_QUEUED = "child-queued-hang-for-interrupt";

function requestWantsHang(request: LlmChatRequest): boolean {
  for (const message of request.messages) {
    if (message.role !== "user") continue;
    const content = message.content as unknown;
    if (typeof content === "string") {
      if (/hang/i.test(content)) return true;
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type: string }).type === "text" &&
        "text" in part &&
        /hang/i.test(String((part as { text: unknown }).text))
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Streams hang when the latest user text contains "hang"; otherwise complete. */
function createConditionalHangAdapter(): LlmAdapter {
  let completeSeq = 0;
  return {
    id: "conditional-hang",
    async chat() {
      throw new Error("chat unused — product-shell uses stream");
    },
    async *stream(request): AsyncIterable<LlmStreamEvent> {
      const hang = requestWantsHang(request);
      const text = hang
        ? HANG_PREFIX
        : completeSeq === 0
          ? AFTER_STOP
          : `complete-${String(++completeSeq)}`;
      if (!hang) completeSeq += 1;
      yield { type: "text-delta", index: 0, text };
      if (hang) {
        await new Promise<void>((_resolve, reject) => {
          const onAbort = (): void => {
            reject(new DOMException("aborted", "AbortError"));
          };
          if (request.signal?.aborted) {
            onAbort();
            return;
          }
          request.signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      yield { type: "done", content: text };
    },
  };
}

/** Idle-only: second SQLite open is safe after the turn has ended. */
function readSessionLog(sessionsDir: string, sessionId: string): string {
  const store = createPersistentSessionStore(sessionsDir);
  try {
    return toJSONL(store.get(sessionId).events);
  } finally {
    store.close();
  }
}

type HistoryRow = {
  event: {
    type: string;
    data?: {
      inserted?: { id: string; content?: { type: string; text?: string }[] }[];
      text?: string;
      content?: unknown;
    };
  };
};

/** Admit id via Face history (Host store) — never a parallel PersistentSessionStore. */
async function admitIdForQueuedText(
  base: string,
  sessionId: string,
  needle: string,
): Promise<string> {
  const hist = await faceRpc(base, "session.history", {
    sessionId,
    maxMessages: 200,
  });
  expect(hist.ok, JSON.stringify(hist.error)).toBe(true);
  const rows = (hist.value as { events: HistoryRow[] }).events ?? [];
  for (const row of rows) {
    if (row.event.type !== "agent/inbox/spliced") continue;
    for (const msg of row.event.data?.inserted ?? []) {
      const body = (msg.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      if (body.includes(needle)) return msg.id;
    }
  }
  throw new Error(`no queued admit for ${JSON.stringify(needle)}`);
}

describe.skipIf(!HAS_SHELL)("product shell subagent queue / steer / stop", () => {
  it(
    "parent QueueDock queue/Steer/Stop; Face continuable steer+interrupt; one-shot fenced",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-subq-",
        llm: createConditionalHangAdapter(),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);

        const listed = await faceRpc(shell.base, "session.list", {});
        expect(listed.ok, JSON.stringify(listed.error)).toBe(true);
        const parentId = (listed.value as { items: { sessionId: string }[] })
          .items[0]?.sessionId;
        expect(parentId).toBeTypeOf("string");

        // --- Parent chrome: queue · Steer · Stop ---
        const composer = page.locator("textarea:enabled").first();
        await composer.fill("hang until stop");
        await page.getByRole("button", { name: /发送消息|Send message/ }).click();

        const stop = page.getByRole("button", {
          name: /Stop generating|停止生成/,
        });
        await stop.waitFor({ state: "visible", timeout: 20_000 });
        await page.getByText(HANG_PREFIX).waitFor({ timeout: 15_000 });

        // Queue via Face while the turn hangs (avoids controlled-textarea draft
        // races under Stop-primary). Steer + Stop stay product chrome.
        const parentQueued = await faceRpc(shell.base, "session.prompt", {
          sessionId: parentId,
          mode: "queue",
          content: [{ type: "text", text: QUEUED }],
        });
        expect(parentQueued.ok, JSON.stringify(parentQueued.error)).toBe(true);
        await page
          .locator("[data-queue-dock]")
          .getByText(QUEUED, { exact: true })
          .waitFor({ timeout: 15_000 });
        const steerBtn = page.getByRole("button", {
          name: "Steer queued message",
        });
        await steerBtn.waitFor({ timeout: 10_000 });
        expect(await steerBtn.isEnabled()).toBe(true);
        await steerBtn.click();

        await stop.click({ timeout: 10_000 });
        await expect
          .poll(async () => stop.isVisible().catch(() => false), {
            timeout: 30_000,
          })
          .toBe(false);
        await page.getByText(/Stopped|已停止/).waitFor({ timeout: 15_000 });

        const parentLog = readSessionLog(shell.sessionsDir, parentId!);
        expect(parentLog).toContain('"kind":"aborted"');
        expect(parentLog).toContain(HANG_PREFIX);
        expect(parentLog).toContain(QUEUED);

        // --- Continuable child: Face hang → queue → steer → interrupt ---
        const child = await faceRpc(shell.base, "session.create", {
          parentSessionId: parentId,
          mode: "continuable",
          label: "worker",
        });
        expect(child.ok, JSON.stringify(child.error)).toBe(true);
        const childId = (child.value as { sessionId: string }).sessionId;

        const hung = await faceRpc(shell.base, "session.prompt", {
          sessionId: childId,
          mode: "queue",
          content: [{ type: "text", text: CHILD_HANG }],
        });
        expect(hung.ok, JSON.stringify(hung.error)).toBe(true);

        await expect
          .poll(
            async () => {
              const hist = await faceRpc(shell.base, "session.history", {
                sessionId: childId,
                maxMessages: 50,
              });
              return JSON.stringify(hist.value ?? {}).includes(HANG_PREFIX);
            },
            { timeout: 20_000 },
          )
          .toBe(true);

        const childQueued = await faceRpc(shell.base, "session.prompt", {
          sessionId: childId,
          mode: "queue",
          content: [{ type: "text", text: CHILD_QUEUED }],
        });
        expect(childQueued.ok, JSON.stringify(childQueued.error)).toBe(true);

        const queuedAdmitId = await admitIdForQueuedText(
          shell.base,
          childId,
          CHILD_QUEUED,
        );

        const steered = await faceRpc(shell.base, "session.updateQueue", {
          sessionId: childId,
          itemId: queuedAdmitId,
          action: { kind: "steer" },
        });
        expect(steered.ok, JSON.stringify(steered.error)).toBe(true);

        await new Promise((r) => setTimeout(r, 400));

        const interrupted = await faceRpc(shell.base, "subagent.interrupt", {
          parentSessionId: parentId,
          childSessionId: childId,
          mode: "continuable",
        });
        expect(interrupted.ok, JSON.stringify(interrupted.error)).toBe(true);

        await expect
          .poll(
            async () => {
              const hist = await faceRpc(shell.base, "session.history", {
                sessionId: childId,
                maxMessages: 100,
              });
              return JSON.stringify(hist.value ?? {}).includes('"kind":"aborted"')
                || JSON.stringify(hist.value ?? {}).includes("aborted");
            },
            { timeout: 20_000 },
          )
          .toBe(true);

        const childLog = readSessionLog(shell.sessionsDir, childId);
        expect(childLog).toContain(CHILD_HANG);
        expect(childLog).toContain(CHILD_QUEUED);
        expect(childLog).toContain('"kind":"aborted"');

        const catalog = await faceRpc(shell.base, "subagent.list", {
          parentSessionId: parentId,
        });
        expect(catalog.ok, JSON.stringify(catalog.error)).toBe(true);
        const entries = (
          catalog.value as {
            entries: { id: string; mode: string }[];
          }
        ).entries;
        expect(
          entries.some((e) => e.id === childId && e.mode === "continuable"),
        ).toBe(true);

        // --- One-shot fence ---
        const oneShot = await faceRpc(shell.base, "session.create", {
          parentSessionId: parentId,
          mode: "one-shot",
          label: "shot",
        });
        expect(oneShot.ok, JSON.stringify(oneShot.error)).toBe(true);
        const oneShotId = (oneShot.value as { sessionId: string }).sessionId;
        const fenced = await faceRpc(shell.base, "session.updateQueue", {
          sessionId: oneShotId,
          itemId: "admit_missing",
          action: { kind: "remove" },
        });
        expect(fenced.ok).toBe(false);
        expect(fenced.error?.code).toBe("subagent-not-resumable");

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    120_000,
  );
});
