/**
 * Host-serve connection recovery beside Settings: auto-backoff after mux/host
 * WS loss, then user-triggered reconnect. Not the Cordis lifecycle-chrome lane.
 */
import { chromium, type WebSocketRoute } from "playwright";
import { describe, expect, it } from "vitest";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import {
  HAS_SHELL,
  LIVE_PLACEHOLDER,
  prepareLiveComposer,
  spawnRegisteredWorkspace,
} from "./product-shell-host.ts";

describe.skipIf(!HAS_SHELL)("product shell reconnect", () => {
  it(
    "shows automatic reconnect chrome and recovers after a manual retry",
    async () => {
      const shell = await spawnRegisteredWorkspace({
        label: "xrk-reconnect-",
        llm: createReplayAdapter([{ content: "reconnect-pong" }]),
      });
      const browser = await chromium.launch();
      const pageErrors: string[] = [];
      const page = await browser.newPage({ locale: "en-US" });
      page.on("pageerror", (err) => {
        pageErrors.push(String(err));
      });
      const sockets: WebSocketRoute[] = [];
      let holdConnections = false;
      try {
        // Route before first navigation so the product-shell handshake is proxied.
        await page.routeWebSocket("**/api/events.**", (route) => {
          sockets.push(route);
          if (holdConnections) return;
          route.connectToServer();
        });
        await page.goto(shell.base, { waitUntil: "domcontentloaded" });
        await prepareLiveComposer(page, shell, pageErrors);
        await expect
          .poll(() => sockets.length, { timeout: 20_000 })
          .toBeGreaterThanOrEqual(2);

        holdConnections = true;
        for (const socket of [...sockets]) {
          await socket.close({ code: 4001, reason: "product-shell reconnect" });
        }

        const connecting = page.getByRole("button", {
          name: "Connecting, restart now",
          exact: true,
        });
        await connecting.waitFor({ timeout: 10_000 });
        expect(await page.getByPlaceholder(LIVE_PLACEHOLDER).isDisabled()).toBe(
          true,
        );

        holdConnections = false;
        await connecting.click();
        await page
          .getByRole("status", { name: "Connected", exact: true })
          .waitFor({ timeout: 15_000 });
        await expect
          .poll(
            async () => page.getByPlaceholder(LIVE_PLACEHOLDER).isEnabled(),
            { timeout: 15_000 },
          )
          .toBe(true);
      } finally {
        await browser.close();
        await shell.dispose();
      }
    },
    90_000,
  );
});
