/**
 * Host-serve policy ask: replay todo_write → composer takeover
 * `[data-approval-key]` → Allow once → `/api/respond` → tool + final text.
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { askToolNames, createPolicyEngine } from "@xrkseek/policy";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  sendComposerPrompt,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

const MARKER = "approval-once-ok";

describe.skipIf(!HAS_SHELL)("product shell approval", () => {
  it(
    "shows the ask panel, allows once, and lands the tool result",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-ask-",
        policy: createPolicyEngine({
          rules: [askToolNames(["todo_write"])],
        }),
        llm: createReplayAdapter([
          {
            content: "",
            toolCalls: [
              {
                id: "c-ask",
                name: "todo_write",
                arguments: {
                  todos: [
                    {
                      id: "1",
                      content: "wait for allow",
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
        await sendComposerPrompt(page, "update the todo then stop");

        const panel = page.locator("[data-approval-key]");
        try {
          await panel.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `approval panel missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }

        await page.getByRole("button", { name: /Allow once|允许一次/ }).click();
        await panel.waitFor({ state: "hidden", timeout: 20_000 });
        await page.getByText(MARKER).waitFor({ timeout: 20_000 });

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
        expect(log).toContain('"type":"approval/asked"');
        expect(log).toContain('"type":"approval/decided"');
        expect(log).toContain('"decision":"allow"');
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
