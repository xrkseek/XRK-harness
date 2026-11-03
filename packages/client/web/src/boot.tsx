/**
 * Web shell boot kernel — the face consumed by the apps/web entry. Everything
 * here is machinery that cannot itself be a loader entry, and none of it
 * value-imports a plugin package (shell self-sufficiency rule: the
 * loading page must work while — especially when — plugins fail). The one
 * sanctioned exception is the modules package (bootstrap
 * identity): the module system cannot arrive through itself, so its class
 * and its client-half wrapper are shell-bundled and the kernel adopts its
 * plugin entry once cordis is up.
 *
 * AppWebEntry.run(), module face first, then plugin face: parse
 * `window.__XRK_BOOT__` into the two-view BootManifest (wire boundary)
 * → build the module system over the module-view rows → render the loading
 * page → start the `immediately`-tier script fetches while mounting the
 * vendored cordis Loader (`internal` contract injection BEFORE any entry exists —
 * the bare-import fallback in tree.import must never run in a browser) →
 * await those factories, THEN adopt the modules entry and create one
 * loader entry per plugin-view row plus the shell-own app-shell assembly
 * entry → loader.await() inside the activation budget + a full fiber sweep
 * (all ACTIVE, else fail naming the inactive entry ids) → wait for Desktop
 * Host Fetch (when present; started in parallel with plugin fetch so one
 * splash covers Host + plugins), connection handshake phases, and the first
 * session-list ready → flip the settled signal so AppRoot's HARNESS splash
 * switches to the real UI in one pass (no empty shell flash). Progressive
 * splash hints track that chain (Host ∥ plugins → Face streams → sessions) on
 * a single dual-ring.
 *
 * Entry creation waits for the whole immediately tier: materialization runs
 * synchronous cross-package require edges (e.g. locale → runtime/client) that
 * fiber inject waiting cannot protect — a bundle's factory must be
 * registered before any dependent entry materializes. Rows outside that tier
 * are not prefetched: entry creation imports every one of them in the same
 * tick, so the loader still starts them together — but the first request wave
 * carries ~8 critical bundles instead of a 40-request burst, which is what a
 * weak network actually has to chew through before the splash can lift.
 * Per-row prefetch failures still resolve silently (the create-side import
 * reloads and owns the loud failure), so the barrier never turns one bad
 * bundle into a boot-wide fail-fast.
 *
 * The activation stage runs under a stall window ({@link BOOT_ACTIVATION_STALL_MS}):
 * `create()` awaits each fiber's settle and the tree quiesce has no deadline of
 * its own, so one apply that never resolves would hold the splash forever. When
 * the stage stops moving, the sweep names the still-inactive entry ids on the
 * failure page instead of aborting with one anonymous message.
 *
 * Composition lives in the host graph; the shell makes zero composition
 * decisions (the app-shell assembly is itself a graph entry, the only
 * shell-own module registered with the module system).
 */
import { Context } from '@xrkseek/cordis'
import Loader from '@xrkseek/cordis-plugin-loader'
import { createRoot, type Root } from 'react-dom/client'
import * as ModulesClient from '@xrkseek/client-modules/client'
import {
  ClientModuleSystem, parseBootManifest,
  type BootManifest, type BootPluginRow, type ClientModuleSystemOptions, type XrkWindow,
} from '@xrkseek/client-modules/client'
import * as AppShell from './app-shell.ts'
import { APP_SHELL_ID } from './app-shell.ts'
import { AppRoot } from './AppRoot.tsx'
import { getStaticModules } from './seed.ts'
import {
  BOOT_HOST_TIP_INTERVAL_MS,
  bootConnectionHint,
  bootHostPhaseHint,
  bootPluginHint,
  bootSessionsHint,
  resolveBootLang,
  type BootHostPhase,
  type BootLang,
} from './boot-hints.ts'
import { clearBooting, stampBooting } from './boot-stamp.ts'
import { watchStall, type StallWatch } from './boot-stall.ts'
import { STATE_LABELS, createLoaderStatusStore, createSignal } from './loader-status.ts'
import './base.css'

/** Minimal connection face the product-ready gate reads (no value-import of the plugin). */
type BootConnectionFace = {
  readonly connectionState: {
    getSnapshot: () => 'connected' | 'reconnecting' | undefined
    subscribe: (fn: () => void) => () => void
  }
  readonly connectionPhase: {
    getSnapshot: () =>
      | 'handshake:host'
      | 'handshake:describe'
      | 'handshake:streams'
      | 'retry:backoff'
      | 'retry:halted'
      | undefined
    subscribe: (fn: () => void) => () => void
  }
  /** Desktop: rebring sticky Host + kick Face out of `retry:halted`. */
  reconnect?: () => void
}

type DesktopHostTransport = {
  whenHostReady?: () => Promise<void>
  getHostPhase?: () => BootHostPhase
  subscribeHostPhase?: (listener: (phase: BootHostPhase) => void) => () => void
  subscribeHostReady?: (listener: () => void) => () => void
  requestHostRebring?: () => void | Promise<void>
}

/**
 * How long the plugin-activation stage may go without progress before the boot
 * gives up waiting on it. Deliberately a stall window, not a wall-clock budget
 * over the whole stage: `create()` awaits each bundle's import, so a wall clock
 * would declare a merely-slow link (32 bundles still arriving) dead. Every
 * projected entry transition and every settled creation re-arms it, so only a
 * stage that genuinely stopped moving — an apply that never resolves — trips
 * it. Tripping does not abort with a generic error: the sweep below turns the
 * still-inactive entries into ids the failure page names.
 */
const BOOT_ACTIVATION_STALL_MS = 8_000

/** Wait until `done` is true, re-checking on every source notification. */
function waitUntilReady(
  sources: ReadonlyArray<{ subscribe: (fn: () => void) => () => void }>,
  done: () => boolean,
  onTick?: () => void,
): Promise<void> {
  if (done()) return Promise.resolve()
  return new Promise((resolve) => {
    const check = (): void => {
      onTick?.()
      if (!done()) return
      for (const unsub of unsubs) unsub()
      resolve()
    }
    const unsubs = sources.map((source) => source.subscribe(check))
    // Race: the predicate may flip between the initial check and subscribe.
    check()
  })
}

/** Module transport hook the shell passes through (jsdom tests replace the <script> path). */
export type BootSeams = Pick<ClientModuleSystemOptions, 'loadBundle'>

/**
 * The modules package's own graph row id. The kernel adopts that entry
 * itself (its wrapper is statically registered — shell-bundled code, never
 * fetched), so the plugin-row loop must skip it: the vendored Group.create
 * does not deduplicate by name, and a second fiber would provide 'modules'
 * twice.
 */
const MODULES_ID = '@xrkseek/client-modules'

/**
 * Boot abort carrying the entry ids that never activated. The failure page
 * renders exactly these ids; the message keeps the per-entry detail for the
 * console only (devtools diagnosis, never splash copy).
 */
class BootActivationError extends Error {
  readonly ids: readonly string[]

  constructor(ids: readonly string[], details: readonly string[]) {
    super(
      `web boot: ${String(ids.length)} entr${ids.length === 1 ? 'y' : 'ies'} did not activate`
      + (details.length === 0 ? '' : `\n${details.join('\n')}`),
    )
    this.name = 'BootActivationError'
    this.ids = ids
  }
}

/**
 * The web shell kernel: mounts the loading page into a DOM element and runs
 * the two-stage boot over the host graph. Fields hold only what must exist
 * before cordis does — the parsed manifest, the module system, and the
 * loading-page UI handles; everything else lives in plugins.
 */
export class AppWebEntry {
  private readonly el: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly status = createLoaderStatusStore()
  private readonly settled = createSignal(false)
  private readonly error = createSignal<string | undefined>(undefined)
  /**
   * Entry ids that never reached ACTIVE (activation sweep). Separate from
   * {@link error} so the failure page can list who — the one-line report has
   * no room for a roster, and a roster is the only thing that locates the bug.
   */
  private readonly failures = createSignal<readonly string[]>([])
  /** Entry creations still running; > 0 means a bundle may still be on the wire. */
  private creatingEntries = 0
  /** Live stall window of the activation stage (undefined outside it). */
  private stall: StallWatch | undefined
  private readonly hint = createSignal(bootPluginHint({}, resolveBootLang()))
  private readonly bootLang = createSignal<BootLang>(resolveBootLang())
  /** Splash retry control while Desktop Host gate is parked on failure. */
  private readonly onRetryHost = createSignal<(() => void) | undefined>(undefined)
  /** While true, status transitions refresh the plugin-tier splash hint. */
  private pluginHintActive = true
  /**
   * Desktop: false until `whenHostReady` resolves. While false, Host tip
   * ladder owns the splash hint (plugins prefetch in the background).
   * Non-Desktop boots leave this true so plugin hints paint immediately.
   */
  private hostAttached = true
  private hostTipCleanup: (() => void) | undefined
  /** Stops Desktop Host gate retry loop (dispose / boot-chain failure). */
  private hostGateAbandoned = false
  private hostBootRetryWake: (() => void) | undefined
  // Assigned by run() before any private method or settled-gated closure reads them.
  private ctx!: Context
  private modules!: ClientModuleSystem
  private manifest!: BootManifest
  private root: Root | undefined

  /**
   * Hold the mount point; all work happens in {@link run}.
   * @param el - mount point (the app's #root).
   * @param seams - Optional module transport overrides for test environments.
   */
  constructor(el: HTMLElement, seams?: BootSeams) {
    this.el = el
    this.seams = seams
  }

  /**
   * Run the boot chain to settlement. Boot-chain failures resolve (not
   * reject): the loading page stays up and renders the failure report (the
   * fail-loud surface the kernel owns). Rejects only when the boot manifest
   * is missing or malformed — there is nothing to boot against.
   * @returns resolves once the UI settled or the failure report rendered.
   */
  async run(): Promise<void> {
    this.manifest = parseBootManifest((globalThis as XrkWindow).__XRK_BOOT__)

    this.modules = new ClientModuleSystem({
      modules: this.manifest.modules, staticModules: getStaticModules(), ...this.seams,
    })
    // The app-shell assembly is the only shell-own module: every other graph
    // row is a plugin bundle arriving through fetch.
    this.modules.registerStatic(APP_SHELL_ID, AppShell)
    // Adoption handoff, supply side: register the modules
    // package's own client half under its bare package name (= graph row id
    // = entry name — a suffixed key would miss the statics branch and
    // trigger a real fetch), and put the instance on the kernel slot the
    // wrapper's apply reads to provide ctx.modules.
    this.modules.registerStatic(MODULES_ID, ModulesClient)
    ;(globalThis as XrkWindow).__XRK_MODULES__ = this.modules

    this.root = createRoot(this.el)
    // Stamp before plugin fibers so body-portaled FABs stay hidden on first paint.
    stampBooting(this.bootLang.getSnapshot())
    void this.primeBootLang()
    this.root.render(
      <AppRoot
        settled={this.settled}
        status={this.status}
        error={this.error}
        failures={this.failures}
        hint={this.hint}
        lang={this.bootLang}
        onRetryHost={this.onRetryHost}
        renderApp={() => {
          const shell = this.ctx.get('appShell')
          // Unreachable after a clean settle (the app-shell entry is in every graph).
          if (shell === undefined) throw new Error('web boot: appShell service missing after settled')
          return shell.renderApp()
        }}
      />,
    )

    // Desktop Host gate starts with the splash so cold Host spawn and plugin
    // prefetch share one dual-ring (no static-HTML remount seam).
    const hostReady = this.beginDesktopHostGate()
    // The immediately tier starts fetching now; runPluginBoot awaits those
    // factories before creating entries (see module comment: cross-package
    // synchronous require edges need them registered before any
    // materialization). Every other row is fetched on demand by the loader.
    const prefetching = this.prefetchImmediateTier()
    this.ctx = new Context()
    try {
      await this.runPluginBoot(prefetching)
      this.adoptProductLocale()
      await hostReady
      await this.awaitProductReady()
      // AppRoot keeps the splash over the first product paint, then clearBooting.
      this.settled.set(true)
    } catch (reason) {
      // Stay on the loading page; surface the sweep report (fail loud).
      console.error(reason)
      const ids = reason instanceof BootActivationError ? reason.ids : []
      this.failures.set(ids)
      // Activation failures render as one row per id (the message carries the
      // same ids plus service detail — console only). Everything else (Host /
      // connection) keeps its single line.
      this.error.set(ids.length > 0
        ? undefined
        : reason instanceof Error ? reason.message : String(reason))
    } finally {
      this.abandonDesktopHostGate()
    }
  }

  /** Unmount the shell (loading page or settled UI). */
  dispose(): void {
    this.abandonDesktopHostGate()
    clearBooting()
    this.root?.unmount()
  }

  /** End Host tip ladder + retry park (idempotent). */
  private abandonDesktopHostGate(): void {
    this.hostGateAbandoned = true
    this.hostBootRetryWake?.()
    this.hostBootRetryWake = undefined
    this.onRetryHost.set(undefined)
    this.stopDesktopHostTips()
  }

  /** Prefer Desktop shell locale, then navigator (before locale plugin). */
  private async primeBootLang(): Promise<void> {
    const desktop = (globalThis as {
      xrkDesktop?: { locale?: () => Promise<{ readonly id?: string }> }
    }).xrkDesktop
    let desktopLocaleId: string | undefined
    if (typeof desktop?.locale === 'function') {
      try {
        const snap = await desktop.locale()
        desktopLocaleId = snap.id
      } catch {
        /* ignore — fall through to navigator */
      }
    }
    this.setBootLang(
      // exactOptionalPropertyTypes: an absent id must be an absent key.
      resolveBootLang(desktopLocaleId === undefined ? {} : { desktopLocaleId }),
    )
  }

  /** After plugins activate, adopt product Settings language when present. */
  private adoptProductLocale(): void {
    const locale = this.ctx.get('locale') as
      | { getLocale?: () => { active?: string } }
      | undefined
    const productLocaleId = locale?.getLocale?.().active
    if (productLocaleId === undefined) return
    this.setBootLang(resolveBootLang({ productLocaleId }))
  }

  private setBootLang(lang: BootLang): void {
    if (this.bootLang.getSnapshot() === lang) {
      if (this.pluginHintActive) this.refreshPluginHint()
      return
    }
    this.bootLang.set(lang)
    if (!this.settled.getSnapshot()) stampBooting(lang)
    if (this.pluginHintActive) this.refreshPluginHint()
  }

  /** Project loader status onto the splash hint during the plugin tier. */
  private refreshPluginHint(): void {
    if (!this.pluginHintActive) return
    // Host tip ladder owns the line until Desktop Fetch is attached.
    if (!this.hostAttached) return
    this.hint.set(bootPluginHint(this.status.getSnapshot(), this.bootLang.getSnapshot()))
  }

  private stopDesktopHostTips(): void {
    this.hostTipCleanup?.()
    this.hostTipCleanup = undefined
  }

  /**
   * Desktop: start Host tip ladder + `whenHostReady` alongside plugin prefetch
   * so cold Host spawn never needs a second splash document.
   * On sticky Host failure, park on the splash with Retry (rebring) instead of
   * a dead-end error that requires quitting the app.
   * Web / non-Desktop: no-op (hostAttached stays true).
   */
  private beginDesktopHostGate(): Promise<void> {
    const transport = (globalThis as XrkWindow & {
      __XRK_TRANSPORT__?: DesktopHostTransport
    }).__XRK_TRANSPORT__

    if (typeof transport?.whenHostReady !== 'function') {
      this.hostAttached = true
      return Promise.resolve()
    }

    const runAttempt = async (): Promise<void> => {
      if (this.hostGateAbandoned) return
      this.hostAttached = false
      this.onRetryHost.set(undefined)
      this.startDesktopHostTips(transport)
      try {
        await transport.whenHostReady!()
        if (this.hostGateAbandoned) return
        this.hostAttached = true
        this.stopDesktopHostTips()
        this.error.set(undefined)
        this.onRetryHost.set(undefined)
        if (this.pluginHintActive) this.refreshPluginHint()
      } catch (reason) {
        if (this.hostGateAbandoned) return
        this.stopDesktopHostTips()
        const message = reason instanceof Error ? reason.message : String(reason)
        this.error.set(message)
        await this.waitForHostBootRetry(transport)
        if (this.hostGateAbandoned) return
        this.error.set(undefined)
        await runAttempt()
      }
    }
    return runAttempt()
  }

  /** Tip ladder while Host Fetch is not yet attached. */
  private startDesktopHostTips(transport: DesktopHostTransport): void {
    this.stopDesktopHostTips()
    const lang = (): BootLang => this.bootLang.getSnapshot()
    const startedAt = Date.now()
    let phase: BootHostPhase = transport.getHostPhase?.() ?? 'starting'
    const paintHostHint = (): void => {
      if (this.hostAttached) return
      const next = bootHostPhaseHint(phase, lang(), {
        elapsedMs: Date.now() - startedAt,
      })
      if (this.hint.getSnapshot() === next) return
      this.hint.set(next)
    }
    paintHostHint()
    const unsubPhase = transport.subscribeHostPhase?.((next) => {
      phase = next
      paintHostHint()
    })
    const tipTimer = setInterval(paintHostHint, Math.max(400, BOOT_HOST_TIP_INTERVAL_MS / 2))
    this.hostTipCleanup = () => {
      clearInterval(tipTimer)
      unsubPhase?.()
    }
  }

  /**
   * After sticky Host failure: wait for splash Retry (rebring) or a late
   * `hostReady` pulse before re-entering {@link beginDesktopHostGate}.
   */
  private waitForHostBootRetry(transport: DesktopHostTransport): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        unsubReady?.()
        this.hostBootRetryWake = undefined
        this.onRetryHost.set(undefined)
        resolve()
      }
      this.hostBootRetryWake = finish
      if (this.hostGateAbandoned) {
        finish()
        return
      }
      const unsubReady = transport.subscribeHostReady?.(() => {
        finish()
      })
      this.onRetryHost.set(() => {
        // Await IPC: clearing sticky happens in main; racing whenHostReady
        // rejects on the old sticky and forces a second Retry click.
        void Promise.resolve(transport.requestHostRebring?.()).finally(() => {
          finish()
        })
      })
    })
  }

  /**
   * Keep the HARNESS splash up until Face can paint a real session list.
   * Host Fetch was awaited in {@link beginDesktopHostGate} (parallel with
   * plugins). Remaining chain: Face handshake (describe / streams) →
   * `sessions.list.phase === 'ready'`. Copy follows {@link bootLang} (zh/en).
   */
  private async awaitProductReady(): Promise<void> {
    this.pluginHintActive = false
    this.stopDesktopHostTips()
    const lang = (): BootLang => this.bootLang.getSnapshot()

    const connection = this.ctx.get('connection') as BootConnectionFace | undefined
    if (connection !== undefined && connection.connectionState.getSnapshot() !== 'connected') {
      const paintConnectionHint = (): void => {
        if (connection.connectionState.getSnapshot() === 'connected') {
          this.error.set(undefined)
          this.onRetryHost.set(undefined)
          return
        }
        const phase = connection.connectionPhase.getSnapshot()
        // Host sticky fail after Fetch attach: splash has no Settings footer —
        // arm Retry so cold start is not wedged on a spinning dual-ring.
        if (phase === 'retry:halted') {
          this.armProductReadyHostRetry(connection)
          this.hint.set(bootConnectionHint(phase, {
            hostAttached: this.hostAttached,
            lang: lang(),
          }))
          return
        }
        this.onRetryHost.set(undefined)
        this.hint.set(bootConnectionHint(phase, {
          hostAttached: this.hostAttached,
          lang: lang(),
        }))
      }
      paintConnectionHint()
      await waitUntilReady(
        [connection.connectionState, connection.connectionPhase],
        () => connection.connectionState.getSnapshot() === 'connected',
        paintConnectionHint,
      )
      this.error.set(undefined)
      this.onRetryHost.set(undefined)
    }

    const sessions = this.ctx.get('sessions') as
      | { list: { getSnapshot: () => { phase: string }; subscribe: (fn: () => void) => () => void } }
      | undefined
    if (sessions === undefined) return

    this.hint.set(bootSessionsHint(lang()))
    await waitUntilReady(
      [sessions.list],
      () => sessions.list.getSnapshot().phase === 'ready',
    )
  }

  /**
   * Face parked on `retry:halted` during product-ready wait: show fail chrome
   * + Retry (rebring + reconnect). Web has no transport rebring — no-op arm.
   */
  private armProductReadyHostRetry(connection: BootConnectionFace): void {
    if (this.onRetryHost.getSnapshot() !== undefined) return
    const transport = (globalThis as XrkWindow & {
      __XRK_TRANSPORT__?: DesktopHostTransport
    }).__XRK_TRANSPORT__
    if (typeof transport?.requestHostRebring !== 'function' && connection.reconnect === undefined) {
      return
    }
    this.error.set(
      bootConnectionHint('retry:halted', {
        hostAttached: this.hostAttached,
        lang: this.bootLang.getSnapshot(),
      }),
    )
    this.onRetryHost.set(() => {
      // connection.reconnect awaits rebring then kicks the controller.
      connection.reconnect?.()
    })
  }

  /**
   * Prefetch the `immediately` tier only — the one whose factories must exist
   * before any entry materializes. Every other row is fetched by the loader on
   * demand (entry creation imports all of them in the same tick), so leaving
   * them out of the boot wave costs no concurrency: it just stops ~30 unrelated
   * bundles from queueing ahead of the critical ones on a slow link. One
   * `Promise.all` over the whole tier — a second serial wave only delays rows
   * the synchronous require edges need just as early. Failures defer to the
   * import path.
   */
  private async prefetchImmediateTier(): Promise<void> {
    const prefetch = (row: BootPluginRow) =>
      this.modules.prefetch(row.id).catch(() => {
        // Import reloads and reports this loudly per entry; swallowing
        // here keeps one failing prefetch from masking the others.
      })
    await Promise.all(this.manifest.plugins.filter((row) => row.immediately).map(prefetch))
  }

  /** Plugin face: mount the Loader, inject the `internal` contract, adopt modules, create the graph entries, settle, sweep. */
  private async runPluginBoot(prefetching: Promise<void>): Promise<void> {
    const ctx = this.ctx
    await ctx.plugin(Loader)
    const loader = ctx.loader
    // Inject the module system BEFORE any entry exists: tree.import falls back
    // to a bare dynamic import when internal is undefined, which in a browser
    // is a guaranteed loud failure — correct as a tripwire, never as a path.
    loader.internal = this.modules as never

    // Status projection: AppRoot displays fiber truth. Every internal/status
    // transition under an entry re-projects that entry's row from its ROOT
    // fiber (child plugin fibers share the same entry).
    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.stall?.notify()
      this.status.set(entry.options.name, STATE_LABELS[entry.fiber.state])
      this.refreshPluginHint()
    })

    // Barrier before any entry exists: entry creation materializes bundles,
    // and materialization runs synchronous cross-package require edges that
    // need every immediately-tier factory already registered (module
    // comment). Resolves even when individual prefetches failed.
    await prefetching

    // Adoption handoff, plugin side: the modules entry is created first —
    // its wrapper apply reads the kernel slot and provides ctx.modules (the
    // provide lives on the plugin face; see MODULES_ID for why the row loop
    // must then skip it).
    const rows = [MODULES_ID, ...this.manifest.plugins.map(row => row.id).filter(id => id !== MODULES_ID), APP_SHELL_ID]
    // Entry creation order carries no semantics (fiber inject waiting owns
    // activation order); creating concurrently lets any still-arriving
    // bundles finish in parallel. The app-shell assembly entry is appended by the
    // kernel: it is shell-own code (host graph rows are all plugin bundles),
    // and mounting the assembly is not a composition decision — it rides the
    // same entry lifecycle so the sweep and status cover it uniformly.
    // Activation stage: entry creation, then tree quiesce, under the stall
    // window. `create()` awaits the bundle import AND that entry's fiber
    // settle, so a plugin whose apply never resolves hangs here — not in
    // `loader.await()` — which is why the window covers both.
    await this.awaitActivation((async () => {
      this.creatingEntries = rows.length
      await Promise.all(rows.map(async (name) => {
        this.status.set(name, 'loading')
        this.refreshPluginHint()
        try {
          const id = await loader.create({ name })
          // A failed import leaves the entry fiberless (Entry._init logs and
          // returns); project it as failed — no fiber means no status event.
          if (loader.resolve(id).fiber === undefined) {
            this.status.set(name, 'failed')
            this.refreshPluginHint()
          }
        } finally {
          // Anything settling counts as progress: a slow link must never trip
          // the stall window (see awaitActivation).
          this.creatingEntries -= 1
          this.stall?.notify()
        }
      }))
      await loader.await()
    })())
    this.assertEntriesActive()
  }

  /**
   * Await the activation stage while it keeps moving, up to
   * {@link BOOT_ACTIVATION_STALL_MS} of silence. Neither non-success outcome
   * aborts boot from here: a fiber failure rejects the stage (a bare aggregate
   * that names no entry), and a stuck apply never resolves at all. Both hand
   * over to the sweep, which knows which entries are short of ACTIVE.
   * @param stage - entry creation + tree quiesce.
   */
  private async awaitActivation(stage: Promise<void>): Promise<void> {
    const stall = watchStall(BOOT_ACTIVATION_STALL_MS, () => this.importInFlight())
    this.stall = stall
    try {
      await Promise.race([
        // A rejected stage is the sweep's business (it knows the ids); keep the
        // loader's own detail in devtools. Attaching the handler here also
        // keeps an abandoned stage from going unhandled.
        stage.catch((reason: unknown) => { console.error(reason) }),
        stall.stalled,
      ])
    } finally {
      stall.dispose()
      this.stall = undefined
    }
  }

  /**
   * True while some entry is still waiting on its bundle. A fiberless entry
   * whose creation has not settled is an import in flight; the import-failure
   * projection (`failed`) is the fiberless-but-done exception.
   */
  private importInFlight(): boolean {
    if (this.creatingEntries === 0) return false
    const status = this.status.getSnapshot()
    for (const entry of this.ctx.loader.entries()) {
      if (entry.fiber === undefined && status[entry.options.name] !== 'failed') return true
    }
    return false
  }

  /**
   * Sweep every loader entry after the activation wait: an entry without a
   * fiber failed its import; a fiber not ACTIVE is FAILED (apply threw) or
   * PENDING (a required service never arrived). Fails loud with the ids only —
   * per-entry detail rides the thrown message (console), never the splash.
   */
  private assertEntriesActive(): void {
    const ctx = this.ctx
    const ids: string[] = []
    const details: string[] = []
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      if (entry.fiber === undefined) {
        ids.push(name)
        details.push(`${name}: import failed (see console for the import error)`)
        continue
      }
      const state = STATE_LABELS[entry.fiber.state]
      if (state === 'active') continue
      ids.push(name)
      if (state === 'pending') {
        const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
        details.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
      } else {
        details.push(`${name}: ${state}`)
      }
    }
    if (ids.length > 0) throw new BootActivationError(ids, details)
  }
}
