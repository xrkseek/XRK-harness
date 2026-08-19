/** Shared Host-serve spawn for apps/web product-shell e2e (not DSH Cordis scaffold). */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createPersistentSessionStore, toJSONL } from "@xrkseek/core-session";
import { createStdTools } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";
import type { PolicyEngine } from "@xrkseek/policy";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import { loadHostConfig } from "@xrkseek/server-config";
import { createHostManager } from "@xrkseek/server-host";

export const WEB_DIST = path.resolve(process.cwd(), "apps", "web", "dist");

export const HAS_SHELL =
  existsSync(path.join(WEB_DIST, "index.html")) &&
  existsSync(
    path.join(
      WEB_DIST,
      "plugins",
      "@xrkseek",
      "xrk-typert-registry",
      "client.js",
    ),
  );

export async function faceRpc(
  base: string,
  method: string,
  payload: unknown = {},
): Promise<{ ok: boolean; value?: unknown; error?: { code: string } }> {
  const res = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rpcId: method, payload }),
  });
  const body = (await res.json()) as {
    result: { ok: boolean; value?: unknown; error?: { code: string } };
  };
  return body.result;
}

/** Hero or live composer — not the workspace-trigger placeholder. */
export const LIVE_PLACEHOLDER =
  /Describe what you want to build|Message the agent|描述你想要构建的内容|给智能体发消息/;

/** Read the first persisted session log as JSONL text (SQLite or legacy import). */
export function readFirstPersistedSessionLog(sessionsDir: string): string {
  const store = createPersistentSessionStore(sessionsDir);
  try {
    const ids = store.list();
    if (ids.length === 0) {
      throw new Error(`no persisted sessions under ${sessionsDir}`);
    }
    return toJSONL(store.get(ids[0]!).events);
  } finally {
    store.close();
  }
}

export async function spawnProductShell(options: {
  workspaceRoot: string;
  llm: LlmAdapter;
  sessionsDir?: string;
  /** Live-agent tool policy (Host still binds Face `setApprovalHandler`). */
  policy?: PolicyEngine;
  /** Process plugins root (`XRK_PLUGINS_DIR`). */
  pluginsDir?: string;
}): Promise<{
  manager: ReturnType<typeof createHostManager>;
  base: string;
}> {
  const manager = createHostManager();
  const config = loadHostConfig({
    env: {
      XRK_API_KEY: "",
      XRK_HOST: "127.0.0.1",
      XRK_PORT: "0",
    },
    patch: {
      workspaceRoot: options.workspaceRoot,
      webDist: WEB_DIST,
      ...(options.sessionsDir ? { sessionsDir: options.sessionsDir } : {}),
      ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
    },
  });

  // Align live agent tools with Host standing registry (todo_write / ask_user).
  // Minimal preset is fs+skill only; product-shell hard刷 needs std tools.
  const instance = await manager.spawn(
    config,
    async ({ sessionId, store, workspaceRoot: root, plugins }) =>
      createMinimalComposition({
        workspaceRoot: root,
        sessionStore: store,
        sessionId,
        plugins,
        llm: options.llm,
        assemble: true,
        extraTools: createStdTools(),
        ...(options.policy ? { policy: options.policy } : {}),
      }).createAgent(),
  );

  const port = instance.health().port!;
  return { manager, base: `http://127.0.0.1:${port}` };
}

/** Temp workspace + Face `workspace.create`, ready for a live composer. */
export async function spawnRegisteredWorkspace(options: {
  llm: LlmAdapter;
  label?: string;
  policy?: PolicyEngine;
  pluginsDir?: string;
}): Promise<{
  manager: ReturnType<typeof createHostManager>;
  base: string;
  workspaceRoot: string;
  sessionsDir: string;
  dispose: () => Promise<void>;
}> {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), options.label ?? "xrk-shell-"),
  );
  const sessionsDir = path.join(workspaceRoot, ".xrk", "sessions");
  const workspaceDir = path.join(workspaceRoot, "workspace");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const { manager, base } = await spawnProductShell({
    workspaceRoot,
    sessionsDir,
    llm: options.llm,
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
  });
  const created = await faceRpc(base, "workspace.create", { path: workspaceDir });
  if (!created.ok) {
    await manager.stopAll();
    await rm(workspaceRoot, { recursive: true, force: true });
    throw new Error(`workspace.create failed: ${JSON.stringify(created.error)}`);
  }
  return {
    manager,
    base,
    workspaceRoot,
    sessionsDir,
    async dispose() {
      await manager.stopAll();
      await rm(workspaceRoot, { recursive: true, force: true });
    },
  };
}

export async function openEnglishPage(base: string): Promise<{
  browser: Browser;
  page: Page;
  pageErrors: string[];
}> {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const page = await browser.newPage({ locale: "en-US" });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  return { browser, page, pageErrors };
}

export async function dismissWelcome(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", {
    name: /内测声明|Internal Testing Notice/,
  });
  try {
    await dialog.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    // Onboarding may already be completed (reload / persisted workspace).
    return;
  }
  await page.getByRole("button", { name: /继续|Continue/ }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

export async function waitForFaceSessions(
  base: string,
  timeoutMs = 15_000,
): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listed = await faceRpc(base, "session.list");
    const items = (listed.value as { items?: unknown[] } | undefined)?.items;
    if (Array.isArray(items) && items.length > 0) return items;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return [];
}

export async function waitForLiveComposer(
  page: Page,
  timeoutMs = 20_000,
): Promise<void> {
  const live = page.getByPlaceholder(LIVE_PLACEHOLDER);
  try {
    await live.waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    const input = page.locator("textarea").first();
    const placeholder = await input
      .getAttribute("placeholder")
      .catch(() => null);
    const aria = await input.getAttribute("aria-label").catch(() => null);
    throw new Error(
      `live composer missing; placeholder=${JSON.stringify(placeholder)} aria=${JSON.stringify(aria)}`,
      { cause: error },
    );
  }
}

export async function prepareLiveComposer(
  page: Page,
  base: string,
  pageErrors: readonly string[] = [],
): Promise<void> {
  await dismissWelcome(page);
  let sessions = await waitForFaceSessions(base, 12_000);
  if (sessions.length === 0) {
    await page
      .getByRole("button", { name: /新建会话|New session/ })
      .first()
      .click();
    sessions = await waitForFaceSessions(base, 12_000);
  }
  if (sessions.length === 0) {
    throw new Error(
      `no Face session after welcome; page errors: ${pageErrors.join(" | ") || "(none)"}`,
    );
  }
  await waitForLiveComposer(page);
}

export async function sendComposerPrompt(
  page: Page,
  text: string,
): Promise<void> {
  await page.getByPlaceholder(LIVE_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: /发送消息|Send message/ }).click();
}
