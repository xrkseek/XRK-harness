/**
 * Host-serve Settings -> Plugins -> MCP card: paste JSON blocks, persist, survive reload.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  openEnglishPage,
  prepareLiveComposer,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

describe.skipIf(!HAS_SHELL)("product shell mcp settings", () => {
  it(
    "saves MCP desired servers from Plugins and keeps them after reload",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-mcp-",
        llm: createReplayAdapter([{ content: "mcp-idle" }]),
      });
      const { browser, page, pageErrors } = await openEnglishPage(shell.base);
      try {
        await prepareLiveComposer(page, shell, pageErrors);
        await page.getByRole("button", { name: "Settings" }).click();
        const dialog = page.getByRole("dialog", { name: "Settings" });
        await dialog.waitFor({ timeout: 10_000 });
        await dialog.getByRole("button", { name: "Plugins" }).click();
        await dialog.getByRole("tab", { name: "Plugin configuration" }).click();

        const expand = dialog.getByRole("button", {
          name: "Show settings: MCP servers",
        });
        await expand.waitFor({ timeout: 20_000 });
        await expand.click();

        const paste = dialog.locator("#plugin-config-mcp-paste");
        await paste.fill(JSON.stringify({
          mcpServers: {
            "fixture-fs": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            },
          },
        }));
        await dialog.getByRole("button", { name: "Add from JSON" }).click();
        await dialog.getByText("fixture-fs").waitFor({ timeout: 5_000 });
        await dialog.getByRole("button", { name: "Save", exact: true }).click();

        const settingsPath = path.join(shell.xrkHome, "host-settings.json");
        await expect.poll(async () => {
          const raw = await readFile(settingsPath, "utf8");
          return raw.includes("fixture-fs") && raw.includes("npx");
        }, { timeout: 15_000 }).toBe(true);

        await page.reload({ waitUntil: "domcontentloaded" });
        await prepareLiveComposer(page, shell, pageErrors);
        await page.getByRole("button", { name: "Settings" }).click();
        const again = page.getByRole("dialog", { name: "Settings" });
        await again.getByRole("button", { name: "Plugins" }).click();
        await again.getByRole("tab", { name: "Plugin configuration" }).click();
        await again.getByRole("button", {
          name: "Show settings: MCP servers",
        }).click();
        await again.getByText("fixture-fs").waitFor({ timeout: 10_000 });
        await again.getByText(/npx/).waitFor({ timeout: 10_000 });

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
