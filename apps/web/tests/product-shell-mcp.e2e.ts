/**
 * Host-serve Settings → Plugins → MCP card: paste JSON blocks, persist, survive reload.
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
        await prepareLiveComposer(page, shell.base, pageErrors);
        await page.getByRole("button", { name: /Settings|设置/ }).click();
        const dialog = page.getByRole("dialog", { name: /Settings|设置/ });
        await dialog.waitFor({ timeout: 10_000 });
        await dialog.getByRole("button", { name: /Plugins|插件/ }).click();
        await dialog.getByRole("tab", { name: /Plugin configuration|插件配置/ }).click();

        const expand = dialog.getByRole("button", {
          name: /Show settings: MCP servers|展开设置：MCP 服务器/,
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
        await dialog.getByRole("button", { name: /Add from JSON|从 JSON 添加/ }).click();
        await expect(dialog.getByText("fixture-fs")).toBeVisible({ timeout: 5_000 });
        await dialog.getByRole("button", { name: /^Save$|^保存$/ }).click();

        const settingsPath = path.join(shell.xrkHome, "host-settings.json");
        await expect.poll(async () => {
          const raw = await readFile(settingsPath, "utf8");
          return raw.includes("fixture-fs") && raw.includes("npx");
        }, { timeout: 15_000 }).toBe(true);

        await page.reload({ waitUntil: "domcontentloaded" });
        await prepareLiveComposer(page, shell.base, pageErrors);
        await page.getByRole("button", { name: /Settings|设置/ }).click();
        const again = page.getByRole("dialog", { name: /Settings|设置/ });
        await again.getByRole("button", { name: /Plugins|插件/ }).click();
        await again.getByRole("tab", { name: /Plugin configuration|插件配置/ }).click();
        await again.getByRole("button", {
          name: /Show settings: MCP servers|展开设置：MCP 服务器/,
        }).click();
        await expect(again.getByText("fixture-fs")).toBeVisible({ timeout: 10_000 });
        await expect(again.getByText(/npx/)).toBeVisible();

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
