/**
 * Host-serve Plan chip: `/plan` → plan projection → Plan mode chip.
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

describe.skipIf(!HAS_SHELL)("product shell plan", () => {
  it(
    "enters plan mode from /plan and shows the Plan chip",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-plan-",
        llm: createReplayAdapter([{ content: "plan-idle" }]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell.base, pageErrors);
        await sendComposerPrompt(page, "/plan");

        const chip = page.getByRole("button", {
          name: /Plan mode on|计划模式/,
        });
        try {
          await chip.waitFor({ timeout: 20_000 });
        } catch (error) {
          throw new Error(
            `Plan chip missing; page errors: ${pageErrors.join(" | ") || "(none)"}`,
            { cause: error },
          );
        }
        expect(await chip.textContent()).toContain("Plan");

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
        expect(log).toContain('"type":"plan/mode"');
        expect(log).toMatch(/"active":\s*true/);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
