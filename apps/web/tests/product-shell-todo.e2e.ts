/**
 * Host-serve TodoDock: replay todo_write -> Face todos projection
 * -> [data-testid="todo-panel"] above the composer.
 * Standing plan persists across turns until the next todo_write.
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

const TODO = "dock the plan strip";
const MARKER = "todo-dock-ok";
const MARKER2 = "todo-dock-kept";

describe.skipIf(!HAS_SHELL)("product shell todo dock", () => {
  it(
    "shows the standing todo panel after todo_write and keeps it on the next turn",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-dock-",
        llm: createReplayAdapter([
          {
            content: "",
            toolCalls: [
              {
                id: "c-dock",
                name: "todo_write",
                arguments: {
                  todos: [
                    { id: "1", content: TODO, status: "in_progress" },
                    { id: "2", content: "then stop", status: "pending" },
                  ],
                },
              },
            ],
          },
          { content: MARKER },
          { content: MARKER2 },
        ]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await sendComposerPrompt(page, "write todos then stop");

        const panel = page.locator('[data-testid="todo-panel"]');
        try {
          await panel.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `todo panel missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }
        await panel.getByRole("button").first().click();
        await panel.getByText(TODO).waitFor({ timeout: 10_000 });
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });
        // turn/end keeps the standing plan visible while the user reads.
        await panel.waitFor({ state: "visible", timeout: 5_000 });

        await sendComposerPrompt(page, "next turn keeps the plan");
        await page.getByText(MARKER2).waitFor({ timeout: 20_000 });
        // Todos persist across turn/start until overwritten by todo_write.
        await panel.waitFor({ state: "visible", timeout: 15_000 });
        await panel.getByText(TODO).waitFor({ timeout: 5_000 });

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);

        const log = readFirstPersistedSessionLog(shell.sessionsDir);
        expect(log).toContain('"type":"todo/write"');
        expect(log).toContain(TODO);
        expect(log).toContain(MARKER);
        expect(log).toContain(MARKER2);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    120_000,
  );
});
