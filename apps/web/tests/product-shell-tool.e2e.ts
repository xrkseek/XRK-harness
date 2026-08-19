/**
 * Host-serve tool card: replay todo_write → `[data-tool="todo_write"]`
 * + final assistant text + Trajectory tab.
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "todo-row-ok";

describe.skipIf(!HAS_SHELL)("product shell tool", () => {
  it(
    "renders a todo_write row and opens Trajectory without page errors",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-tool-",
        llm: createReplayAdapter([
          {
            content: "",
            toolCalls: [
              {
                id: "c1",
                name: "todo_write",
                arguments: {
                  todos: [
                    {
                      id: "1",
                      content: "wire the card",
                      status: "in_progress",
                    },
                  ],
                },
              },
            ],
          },
          { content: MARKER },
        ]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell.base, pageErrors);
        await sendComposerPrompt(page, "write a todo then stop");

        await page
          .locator('[data-tool="todo_write"]')
          .waitFor({ timeout: 20_000 });
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });

        await page.getByRole("tab", { name: /Trajectory|轨迹/ }).click();
        await page
          .getByRole("region", { name: /Trajectory timeline/ })
          .waitFor({ timeout: 10_000 });

        expect(
          pageErrors,
          `page errors: ${pageErrors.join(" | ") || "(none)"}`,
        ).toEqual([]);

        const files = (await readdir(shell.sessionsDir)).filter((f) =>
          f.endsWith(".jsonl"),
        );
        expect(files.length).toBeGreaterThan(0);
        const log = await readFile(
          path.join(shell.sessionsDir, files[0]!),
          "utf8",
        );
        expect(log).toContain('"type":"tool/call"');
        expect(log).toContain('"type":"tool/result"');
        expect(log).toContain('"name":"todo_write"');
        expect(log).toContain('"type":"todo/write"');
        expect(log).toContain(MARKER);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
