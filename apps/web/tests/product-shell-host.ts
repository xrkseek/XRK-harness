/** Shared Host-serve spawn for apps/web product-shell e2e (not DSH Cordis scaffold). */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { expect } from "vitest";
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
  /** Isolate Face/settings home (default: leave process `XRK_HOME`). */
  xrkHome?: string;
  /** Live-agent tool policy (Host still binds Face `setApprovalHandler`). */
  policy?: PolicyEngine;
  /** Process plugins root (`XRK_PLUGINS_DIR`). */
  pluginsDir?: string;
}): Promise<{
  manager: ReturnType<typeof createHostManager>;
  base: string;
}> {
  const prevHome = process.env.XRK_HOME;
  if (options.xrkHome) {
    process.env.XRK_HOME = options.xrkHome;
  }
  try {
    const manager = createHostManager();
    const config = loadHostConfig({
      env: {
        ...process.env,
        XRK_API_KEY: "",
        XRK_HOST: "127.0.0.1",
        XRK_PORT: "0",
        ...(options.xrkHome ? { XRK_HOME: options.xrkHome } : {}),
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
  } catch (err) {
    if (options.xrkHome) {
      if (prevHome === undefined) delete process.env.XRK_HOME;
      else process.env.XRK_HOME = prevHome;
    }
    throw err;
  }
}

/** Temp workspace + isolated `XRK_HOME` + Face `workspace.create`, ready for a live composer. */
export async function spawnRegisteredWorkspace(options: {
  llm: LlmAdapter;
  label?: string;
  policy?: PolicyEngine;
  pluginsDir?: string;
}): Promise<{
  manager: ReturnType<typeof createHostManager>;
  base: string;
  workspaceRoot: string;
  xrkHome: string;
  sessionsDir: string;
  dispose: () => Promise<void>;
}> {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), options.label ?? "xrk-shell-"),
  );
  const xrkHome = path.join(workspaceRoot, "xrk-home");
  const sessionsDir = path.join(xrkHome, "sessions");
  const workspaceDir = path.join(workspaceRoot, "workspace");
  const prevHome = process.env.XRK_HOME;
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const { manager, base } = await spawnProductShell({
    workspaceRoot,
    sessionsDir,
    xrkHome,
    llm: options.llm,
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
  });
  const created = await faceRpc(base, "workspace.create", { path: workspaceDir });
  if (!created.ok) {
    await manager.stopAll();
    if (prevHome === undefined) delete process.env.XRK_HOME;
    else process.env.XRK_HOME = prevHome;
    await rm(workspaceRoot, { recursive: true, force: true });
    throw new Error(`workspace.create failed: ${JSON.stringify(created.error)}`);
  }
  return {
    manager,
    base,
    workspaceRoot,
    xrkHome,
    sessionsDir,
    async dispose() {
      await manager.stopAll();
      if (prevHome === undefined) delete process.env.XRK_HOME;
      else process.env.XRK_HOME = prevHome;
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
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      pageErrors.push(msg.text());
    }
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  return { browser, page, pageErrors };
}

export async function dismissWelcome(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", {
    name: /欢迎使用 XRK-Harness|Welcome to XRK-Harness/,
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

/** DSH lane: welcome → connect workspace → enabled hero composer. */
export async function prepareLiveComposer(
  page: Page,
  shell: { readonly workspaceRoot: string },
  pageErrors: readonly string[] = [],
): Promise<void> {
  await dismissWelcome(page);
  const live = page.locator(
    'textarea:enabled[placeholder="Describe what you want to build"]',
  );
  if (await live.isVisible().catch(() => false)) return;
  try {
    const { connectFreshWorkspace } = await import('./support.ts');
    await connectFreshWorkspace(page, shell.workspaceRoot);
  } catch (error) {
    const phase = await page
      .locator('div[data-phase]')
      .first()
      .getAttribute('data-phase')
      .catch(() => null);
    throw new Error(
      `live composer not ready; phase=${JSON.stringify(phase)}; page errors: ${pageErrors.join(' | ') || '(none)'}`,
      { cause: error },
    );
  }
}

export async function sendComposerPrompt(
  page: Page,
  text: string,
): Promise<void> {
  await page.getByPlaceholder(LIVE_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: /发送消息|Send message/ }).click();
}

/** Snapshot mode for Host-serve aria goldens (DSH scaffold pattern, no Cordis). */
export type WebSnapshotMode = "replay" | "refresh";

export function webSnapshotMode(
  env: NodeJS.ProcessEnv = process.env,
): WebSnapshotMode {
  return env.XRK_SNAPSHOT === "refresh" ? "refresh" : "replay";
}

/** Collapse clocks / durations / cwd so goldens stay machine-stable. */
export function normalizeAria(snapshot: string, workspaceCwd: string): string {
  const normalizedCwd = workspaceCwd.replace(/\\/g, "/");
  const base =
    normalizedCwd.split("/").filter(Boolean).pop() ?? normalizedCwd;
  return snapshot
    .split(workspaceCwd)
    .join("{{cwd}}")
    .split(normalizedCwd)
    .join("{{cwd}}")
    .split(base)
    .join("{{workspace}}")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "{{uuid}}",
    )
    .replace(
      /~\d+(?:y(?: \d+mo)?|mo(?: \d+d)?)|\b(?:\d+d(?: \d+h(?: \d+m \d+s)?)?|\d+h \d+m \d+s|\d+m ?\d+s|\d+(?:\.\d+)?s|\d+(?:\.\d+)?ms)\b/g,
      (duration) => (duration.startsWith("~") ? duration : "{{duration}}"),
    )
    .replace(
      /约\d+(?:年(?:\d+个月)?|个月(?:\d+天)?)|\d+(?:天(?:\d+小时(?:\d+分\d+秒)?)?|小时\d+分\d+秒|分\d+秒|(?:\.\d+)?秒)/g,
      (duration) => (duration.startsWith("约") ? duration : "{{duration}}"),
    )
    .replace(/\d+(?:\.\d+)?(?= tok\/s(?!\w))/g, "{{throughput}}")
    .replace(/(Compacted \d+ history items \(~)\d+( tokens\))/g, "$1{{tokens}}$2")
    .replace(/\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/g, "{{clock}}")
    .replace(/\d{1,2}月\d{1,2}日 \d{2}:\d{2}/g, "{{clock}}")
    .replace(
      /(?<!\d)\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*[AP]M)?(?!\d)/gi,
      "{{clock}}",
    )
    .replace(/(?<!\d)\d{2}:\d{2}(?!\d)/g, "{{clock}}");
}

/** Poll until two consecutive normalized aria snapshots match (DSH 金标 barrier). */
export async function captureStableAria(
  page: Page,
  selector: string,
  workspaceCwd: string,
): Promise<string> {
  const region = page.locator(selector).first();
  let previous = normalizeAria(await region.ariaSnapshot(), workspaceCwd);
  await expect
    .poll(
      async () => {
        const current = normalizeAria(
          await region.ariaSnapshot(),
          workspaceCwd,
        );
        const stable = current === previous;
        previous = current;
        return stable;
      },
      { timeout: 5_000, message: "aria snapshot did not stabilize" },
    )
    .toBe(true);
  return previous;
}

/** Compare golden or rewrite under `XRK_SNAPSHOT=refresh`. */
export async function compareOrRefreshGolden(
  goldenPath: string,
  actual: string,
  mode: WebSnapshotMode = webSnapshotMode(),
): Promise<void> {
  const payload = `${actual}\n`;
  if (mode === "refresh") {
    await mkdir(path.dirname(goldenPath), { recursive: true });
    await writeFile(goldenPath, payload);
    return;
  }
  if (!existsSync(goldenPath)) {
    throw new Error(
      `missing golden ${goldenPath} — run XRK_SNAPSHOT=refresh pnpm test:web to generate it`,
    );
  }
  expect(payload).toBe(await readFile(goldenPath, "utf8"));
}
