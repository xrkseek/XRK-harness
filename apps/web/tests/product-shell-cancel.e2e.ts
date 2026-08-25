/**
 * Host-serve cancel: hung replay stream -> Stop ->
 * turn/end aborted + assistant interrupted + UI "Stopped" (E.3 / DSH).
 *
 * `invokeLlmWithRetry` buffers chunks until success or cancel flush, so the
 * shell does not paint streaming text while `hangBeforeDone` is parked.
 * Wait past inject + first deltas so the buffer is non-empty, then Stop.
 */
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  readFirstPersistedSessionLog,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "cancel-prefix-marker";

describe.skipIf(!HAS_SHELL)("product shell cancel", () => {
  it(
    "stops a hung stream and records an aborted turn with Stopped UI",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-cancel-",
        llm: createReplayAdapter([{ content: MARKER }], {
          enableStream: true,
          streamDelayMs: 0,
          hangBeforeDone: true,
        }),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "stream slowly");

        const stop = page.getByRole("button", {
          name: /Stop generating|停止生成/,
        });
        await stop.waitFor({ state: "visible", timeout: 20_000 });
        // Turn starts before the LLM; give inject + buffered deltas time to land.
        await new Promise((r) => setTimeout(r, 2_500));
        await stop.waitFor({ state: "visible", timeout: 5_000 });
        await stop.click({ timeout: 10_000 });

        await page
          .getByRole("button", { name: /Send message|发送消息/ })
          .waitFor({ timeout: 30_000 });

        await page.getByText(/Stopped|已停止/).waitFor({ timeout: 15_000 });
        await page.getByText(MARKER).waitFor({ timeout: 10_000 });

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"type":"turn/end"');
        expect(log).toContain('"kind":"aborted"');
        expect(log).not.toContain('"kind":"interrupted"');
        expect(log).toContain('"interrupted":true');
        expect(log).toContain(MARKER);

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
