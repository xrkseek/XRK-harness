// Shared plumbing for the web smoke tests (dist location, free port, failure shots).
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'

/** The built page under test; `pnpm run test:web` rebuilds it before running. */
export const DIST_INDEX = fileURLToPath(new URL('../dist/index.html', import.meta.url))

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Browser language a page must advertise to boot into the product's Chinese
 * surface: with no stored preference the client derives its initial locale
 * from the browser, and Playwright's default browser asks for English.
 */
export const ZH_BROWSER_LOCALE = 'zh-CN'

/**
 * Open the standard browser-test page advertising English before client boot.
 * This keeps role locators and goldens deterministic while leaving the Host
 * settings document free to override the provisional browser-derived locale;
 * scenarios asserting the Chinese surface advertise
 * {@link ZH_BROWSER_LOCALE} instead.
 * @param browser - Playwright browser owning the page.
 * @param height - Viewport height; width is fixed to the lane baseline.
 * @returns the initialized page.
 */
export async function newEnglishPage(browser: Browser, height = 1000): Promise<Page> {
  return await browser.newPage({ viewport: { width: 1680, height }, locale: 'en-US' })
}

/** Fail loud on a stale checkout instead of testing yesterday's bundle. */
export function requireDist(): void {
  if (!existsSync(DIST_INDEX)) {
    throw new Error('web app dist not built — run `pnpm run build` from the repository root (`pnpm run test:web` does this first)')
  }
}

/** OS-assigned free port, released before use (the spawned `dsh web` needs a concrete --port). */
export function probeFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => { reject(new Error('port probe returned no address')) })
        return
      }
      probe.close(() => { resolvePort(address.port) })
    })
  })
}

/**
 * Raise the directory dialog from the hero Workspace chip and leave it on the
 * columns view.
 *
 * The chip is a `aria-haspopup=menu` selector: with workspaces already listed
 * it opens the workspace menu first and `Add workspace…` is the entry to the
 * directory dialog, while on a genuinely empty world the menu collapses to the
 * dialog directly (the picker's only action). Both shapes are products of the
 * same contract, so this drives the chip and then takes whichever appeared.
 *
 * The dialog itself opens on its Places step (the OS-resolved entry added in
 * `f5bcfee5`): the crumb bar and its path-edit affordance only exist once a
 * place is entered. The search input keeps autofocus and every place tile is
 * reachable from it through the documented keyboard contract (↑↓/←→ cycle,
 * Enter opens), so one Enter adopts the focused place without naming any of
 * them — place sets and their order are Host/OS facts, not test fixtures.
 * @param page - the page under test.
 * @param chipLabel - localized accessible name of the placeholder chip.
 * @param addLabel - localized menu entry that opens the directory dialog.
 * @param dialogName - localized accessible name of the directory dialog.
 */
async function openDirectoryDialogFromChip(
  page: Page,
  chipLabel: string,
  addLabel: string,
  dialogName: string,
): Promise<Locator> {
  await page.getByLabel(chipLabel, { exact: true }).click()
  const menu = page.getByRole('menu')
  if (await menu.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)) {
    await menu.getByRole('menuitem', { name: addLabel, exact: true }).click()
  }
  // No menu: the chip raised the dialog itself (empty world).
  const dialog = page.getByRole('dialog', { name: dialogName })
  await dialog.waitFor({ timeout: 10_000 })
  // Skip the Places step so callers land on the view owning `Edit path`. The
  // place tiles load asynchronously and Enter only opens the focused tile, so
  // a too-early keystroke is a no-op: retry until the columns view answers.
  const search = dialog.getByRole('textbox', { name: /Search places|搜索位置/ })
  const editPath = dialog.getByRole('button', { name: /Edit path|编辑路径/ })
  await search.waitFor({ timeout: 10_000 })
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await editPath.isVisible().catch(() => false)) break
    await search.press('Enter')
    await editPath.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {})
  }
  await editPath.waitFor({ timeout: 10_000 })
  return dialog
}

/**
 * Drive the hero's workspace picker through the composed directory dialog
 * until the live composer unlocks. A fresh world has no Workspace, so the boot
 * lands in the Workspace-trigger view state (startup auto-selection has nothing to
 * select); every scenario that types into the composer must connect one
 * first. With nothing to list, activating the textarea raises the dialog directly —
 * adding a workspace is the picker's only entry. The directory is staged here
 * and adopted through the path editor, which is idempotent across the repeated
 * connects a scenario may make; creating a folder from inside the dialog (the
 * product's other half of the same route) is covered by
 * workspace-management.e2e.ts. The default name 'workspace' keeps the session
 * header cwd at <root>/workspace, the materialization proof several scenarios
 * assert.
 * @param page - the page under test.
 * @param root - host directory the workspace folder is staged in (the scaffold's `workspaceCwd`).
 * @param name - folder name staged and adopted as the workspace.
 */
export async function connectFreshWorkspace(page: Page, root: string, name = 'workspace'): Promise<void> {
  mkdirSync(join(root, name), { recursive: true })
  const dialog = await openDirectoryDialogFromChip(
    page, 'Choose workspace', 'Add workspace…', 'Select Workspace Directory',
  )
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, name))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  // The pick connected the workspace: the blank session's live composer
  // replaces the locked placeholder and enables. The surface is a
  // contenteditable `role=textbox` (Lexical), not a `<textarea>`, so the
  // accessible name — the placeholder text the locked state used as its label —
  // is the anchor that survives that swap.
  await page.getByRole('textbox', { name: 'Describe what you want to build' })
    .waitFor({ timeout: 15_000 })
}

/**
 * {@link connectFreshWorkspace} over the product default Chinese locale: the
 * English helper's anchors assume the locale every other scenario boots, so a
 * scenario that deliberately keeps zh needs the localized picker copy.
 * @param page - the browser page under test.
 * @param root - workspace parent directory.
 * @param name - directory created under `root` and connected.
 */
export async function connectFreshWorkspaceZh(page: Page, root: string, name = 'workspace'): Promise<void> {
  mkdirSync(join(root, name), { recursive: true })
  const dialog = await openDirectoryDialogFromChip(
    page, '选择工作区', '添加工作区…', '选择工作区目录',
  )
  await dialog.getByRole('button', { name: '编辑路径' }).click()
  const pathInput = dialog.getByRole('textbox', { name: '编辑路径' })
  await pathInput.fill(join(root, name))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: '打开', exact: true }).click()
  await page.getByRole('textbox', { name: '描述你想要构建的内容' })
    .waitFor({ timeout: 15_000 })
}

/**
 * Live composer surface (Lexical contenteditable `role=textbox`). Prefer this
 * over `textarea:enabled` / `getByPlaceholder` — the product no longer paints
 * a native textarea for the main prompt.
 * @param page - Playwright page.
 * @param name - accessible name (placeholder copy); defaults to en/zh hero + live.
 */
export function composerInput(
  page: Page,
  name: string | RegExp = /Describe what you want to build|Message the agent|描述你想要构建的内容|给智能体发消息/,
): Locator {
  return page.getByRole('textbox', { name })
}

/** Failure evidence goes to the gitignored .artifacts/ (repo convention). */
export async function saveFailureShot(page: Page, name: string): Promise<void> {
  const dir = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
  mkdirSync(dir, { recursive: true })
  try {
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
  } catch {
    // Best-effort evidence: a dead page/browser at failure time must not mask the real assertion error.
  }
}

/**
 * The conversation engine's Context key format, restated here rather than
 * imported: these specs live in the Host compiler aggregate, which must not
 * reach the Client plane. The engine's own copy is
 * `conversationContextKey` in client-runtime; a drift between them makes
 * the key miss its rendered node, so the assertion fails loudly.
 * @param kind - Definition kind.
 * @param id - Definition-local business identity.
 * @returns the engine-owned Context key.
 */
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}
