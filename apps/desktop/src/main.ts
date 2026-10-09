/**
 * Electron process entry ([ADR-0008](../../../docs/adr/0008-desktop-shell-private-host.md)).
 *
 * Wires: single-instance · window lifecycle · private Host on **127.0.0.1
 * loopback** (DSH Desktop posture) · narrow preload · update coordinator.
 * Product UI stays on `xrk-app://` for the whole session; Host Fetch is
 * bridged into the custom protocol after IPC `ready` (no loopback remount).
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  shell,
} from "electron";
import { registerDesktopIpcHandlers } from "./desktop-ipc.js";
import {
  getDesktopHostPhase,
  getLastHostFailure,
  isDesktopHostFetchReady,
  markDesktopHostFetchReady,
  publishDesktopHostFailed,
  publishDesktopHostPhase,
  resetDesktopHostFetchReady,
  scheduleDesktopHostFetchAttach,
  type DesktopHostBringUpHandle,
} from "./desktop-host-attach.js";
import { startDesktopMain } from "./desktop-bootstrap.js";
import {
  desktopSplashBackgroundColor,
  resolveDesktopColorScheme,
  resolveDesktopThemePreference,
  type DesktopColorScheme,
} from "./boot-appearance.js";
import {
  attachDesktopNavigationGuard,
  desktopAppIndexUrl,
  DESKTOP_PROTOCOL_PRIVILEGES,
  DESKTOP_PROTOCOL_SCHEME,
  handleDesktopProtocolRequest,
} from "./protocol.js";
import {
  DESKTOP_WEB_PREFERENCES,
  DESKTOP_WINDOW_DEFAULTS,
  desktopWindowPlatformOptions,
} from "./window-lifecycle.js";
import { isDesktopUpdateFeedEnabled } from "./app-update-config.js";
import { tryCreateDesktopElectronUpdater } from "./desktop-electron-updater.js";
import {
  installDesktopApplicationMenu,
  publishDesktopUpdateState,
  runDesktopManualUpdateCheck,
} from "./desktop-update-shell.js";
import { resolveDesktopLocale } from "./locale.js";
import { DESKTOP_IPC, type DesktopUpdateState } from "./ipc.js";
import { DesktopUpdateCoordinator } from "./update-coordinator.js";
import {
  DesktopUpdateSchedule,
  resolveDesktopUpdateScheduleConfig,
} from "./update-schedule.js";
import {
  resolveDesktopWebRoot,
  resolveDesktopWindowIconPath,
} from "./web-root.js";
import { DesktopHostProcess } from "./host-process.js";
import {
  resolvePackagedDesktopHostRuntime,
  resolveUnpackagedDesktopHostRuntime,
} from "./host-runtime.js";
import {
  resolveDesktopHarnessHome,
  resolveDesktopHostCompileCacheDir,
} from "./paths.js";

/** Sandboxed preload must be CommonJS (`emit-preload.mjs` → `preload-app.cjs`). */
const PRELOAD_APP = fileURLToPath(
  new URL("./preload-app.cjs", import.meta.url),
);
const DESKTOP_APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
/** Product window / dialog title — owned by `locale.ts` dictionaries. */
function desktopWindowTitle(): string {
  return resolveDesktopLocale(app.getLocale()).messages.windowTitle;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_PROTOCOL_PRIVILEGES.scheme,
    privileges: { ...DESKTOP_PROTOCOL_PRIVILEGES.privileges },
  },
]);

/** Resolve splash floor from durable Settings (Host not up yet). */
function resolveBootColorScheme(): DesktopColorScheme {
  const xrkHome = resolveDesktopHarnessHome({
    isPackaged: app.isPackaged,
    desktopAppRoot: DESKTOP_APP_ROOT,
  });
  return resolveDesktopColorScheme(
    resolveDesktopThemePreference(xrkHome),
    nativeTheme.shouldUseDarkColors,
  );
}

function createMainBrowserWindow(): BrowserWindow {
  const icon = resolveDesktopWindowIconPath({ platform: process.platform });
  const colorScheme = resolveBootColorScheme();
  const window = new BrowserWindow({
    ...DESKTOP_WINDOW_DEFAULTS,
    backgroundColor: desktopSplashBackgroundColor(colorScheme),
    ...desktopWindowPlatformOptions(process.platform),
    title: desktopWindowTitle(),
    ...(icon !== undefined ? { icon } : {}),
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: PRELOAD_APP,
    },
  });
  window.setTitle(desktopWindowTitle());
  // Deny in-app popups; open https OAuth / verify URLs in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  attachDesktopNavigationGuard(window.webContents, DESKTOP_PROTOCOL_SCHEME);
  return window;
}

function focusedOrPrimaryWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused !== null && focused !== undefined && !focused.isDestroyed()) {
    return focused;
  }
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

function broadcastUpdate(state: DesktopUpdateState): DesktopUpdateState {
  return publishDesktopUpdateState(BrowserWindow.getAllWindows(), state);
}

/**
 * Host Fetch bridge for `xrk-app://` (set after IPC `ready`, cleared on
 * detach / quit). Product HTML stays on packaged disk; Face / sidebar /
 * community HTTP forward here.
 */
let desktopHostFetchApp:
  | ((request: Request) => Promise<Response>)
  | undefined;

/** Product index on `xrk-app://` — one document for Host + plugin splash. */
function loadProductShell(window: BrowserWindow): void {
  void window.loadURL(
    desktopAppIndexUrl(DESKTOP_PROTOCOL_SCHEME, {
      platform: process.platform,
      colorScheme: resolveBootColorScheme(),
    }),
  );
}

let desktopHost: DesktopHostProcess | undefined;
/** Active bring-up scheduler (auto-restart + manual rebring). */
let desktopHostBringUp: DesktopHostBringUpHandle | undefined;
/** Set on will-quit so Host exit does not auto-restart into a dying app. */
let desktopQuitting = false;
let updateCoordinator: DesktopUpdateCoordinator | undefined;
let updateSchedule: DesktopUpdateSchedule | undefined;

async function startDesktopHostCarrier(
  webRoot: string,
  hooks: {
    readonly onSpawned?: () => void;
    readonly attempt?: number;
  } = {},
): Promise<DesktopHostProcess | undefined> {
  try {
    const runtime = app.isPackaged
      ? resolvePackagedDesktopHostRuntime(process.resourcesPath)
      : resolveUnpackagedDesktopHostRuntime({
          desktopAppRoot: DESKTOP_APP_ROOT,
          webDist: webRoot,
        });
    const xrkHome = resolveDesktopHarnessHome({
      isPackaged: app.isPackaged,
      desktopAppRoot: DESKTOP_APP_ROOT,
    });
    const attempt = hooks.attempt ?? 0;
    const host = new DesktopHostProcess(runtime.nodeExecutable, runtime.projectDir, {
      entry: runtime.entry,
      // Cold start may be slow; mid-session restarts must not pin UI for 120s.
      readyTimeoutMs: attempt === 0 ? 120_000 : 30_000,
      env: {
        XRK_HOME: xrkHome,
        XRK_WEB_DIST: runtime.webDist,
        // Bundled harness-cli — Settings plugin mutate never falls back to PATH.
        XRK_HARNESS_BIN: runtime.harnessCliBin,
        XRK_SURFACE: "desktop",
        NODE_COMPILE_CACHE: resolveDesktopHostCompileCacheDir(xrkHome),
      },
      ...(hooks.onSpawned !== undefined ? { onSpawned: hooks.onSpawned } : {}),
      onEarlyDeath: () => {
        desktopHostFetchApp = undefined;
        if (desktopHost !== undefined) desktopHost = undefined;
        resetDesktopHostFetchReady();
      },
    });
    await host.start();
    desktopHost = host;
    return host;
  } catch (error) {
    // Mid-restart failures must not ErrorBox-spam; final onFailed may dialog.
    console.error(error);
    return undefined;
  }
}

let desktopWebRoot: string | undefined;

function liveHostWindows(): Electron.WebContents[] {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map((win) => win.webContents);
}

function beginDesktopHostBringUp(webRoot: string): void {
  resetDesktopHostFetchReady();
  desktopHostBringUp = scheduleDesktopHostFetchAttach({
    start: (hooks) =>
      startDesktopHostCarrier(webRoot, {
        attempt: hooks.attempt,
        ...(hooks.onSpawned !== undefined ? { onSpawned: hooks.onSpawned } : {}),
      }),
    onPhase: (phase) => {
      publishDesktopHostPhase(phase, DESKTOP_IPC.hostPhase, liveHostWindows());
    },
    attach: (host) => {
      // Keep the existing `xrk-app://` document — wire Fetch, then mark ready
      // so the same React splash continues into plugin / Face boot.
      // Missing origin is handled by the scheduler (stop + restart budget).
      if (host.faceOrigin === undefined) return;
      desktopHostFetchApp = (request) => host.fetch(request);
      markDesktopHostFetchReady(
        DESKTOP_IPC.hostReady,
        DESKTOP_IPC.hostPhase,
        liveHostWindows(),
      );
    },
    detach: () => {
      desktopHostFetchApp = undefined;
      desktopHost = undefined;
    },
    restartMaxAttempts: 5,
    restartDelayMs: 750,
    shouldAbortRestart: () => desktopQuitting,
    onFailed: (error) => {
      publishDesktopHostFailed(
        DESKTOP_IPC.hostFailed,
        liveHostWindows(),
        error.message,
      );
      dialog.showErrorBox(
        desktopWindowTitle(),
        `Desktop Host failed to start:\n${error.message}`,
      );
    },
  });
}

const ownsDesktopInstance = startDesktopMain(app, {
  createWindow: () => createMainBrowserWindow(),
  loadPrimary: (window) => {
    // React HARNESS splash from packaged webRoot — Host Fetch attaches later
    // without remounting (seamless Host → plugins → Face).
    loadProductShell(window as BrowserWindow);
  },
  getWindowCount: () => BrowserWindow.getAllWindows().length,
  onInstanceOwned: () => {
    try {
      desktopWebRoot = resolveDesktopWebRoot({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      });
    } catch (error) {
      console.error(error);
      dialog.showErrorBox(
        desktopWindowTitle(),
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return;
    }
    beginDesktopHostBringUp(desktopWebRoot);
  },
  onReady: () => {
    const webRoot = desktopWebRoot;
    if (webRoot === undefined) return;
    const xrkHome = resolveDesktopHarnessHome({
      isPackaged: app.isPackaged,
      desktopAppRoot: DESKTOP_APP_ROOT,
    });
    const overlayRoot = path.join(xrkHome, "plugins", "web");
    protocol.handle(DESKTOP_PROTOCOL_SCHEME, (request) =>
      handleDesktopProtocolRequest(request, {
        webRoot,
        overlayRoot,
        ...(desktopHostFetchApp !== undefined
          ? { fetchApp: desktopHostFetchApp }
          : {}),
      }),
    );
    registerDesktopShellIpc();
    void bootstrapDesktopUpdates();
  },
});

app.on("will-quit", () => {
  desktopQuitting = true;
  const host = desktopHost;
  desktopHostFetchApp = undefined;
  desktopHost = undefined;
  resetDesktopHostFetchReady();
  if (host !== undefined) {
    void host.stop().catch((error: unknown) => {
      console.error(error);
    });
  }
});

function registerDesktopShellIpc(): void {
  registerDesktopIpcHandlers(ipcMain, {
    getLocale: () => app.getLocale(),
    getAppVersion: () => app.getVersion(),
    getUpdateState: () => updateCoordinator?.state ?? { phase: "idle" },
    checkUpdates: async () => {
      if (updateCoordinator === undefined) return { phase: "idle" };
      return updateSchedule !== undefined
        ? updateSchedule.check(true, true)
        : updateCoordinator.check(true);
    },
    installUpdate: async () => {
      if (updateCoordinator === undefined) {
        throw new Error("xrk desktop: update install is not configured");
      }
      await updateCoordinator.install();
    },
    windowFromEvent: (event) => {
      const sender = (event as { sender?: Parameters<
        typeof BrowserWindow.fromWebContents
      >[0] } | null)?.sender;
      if (sender === undefined || sender === null) return undefined;
      const win = BrowserWindow.fromWebContents(sender);
      if (win === null || win.isDestroyed()) return undefined;
      return win;
    },
    isHostReady: () => isDesktopHostFetchReady(),
    getHostFailed: () => getLastHostFailure() ?? null,
    getHostPhase: () => getDesktopHostPhase(),
    rebringHost: () => {
      desktopHostBringUp?.rebring();
    },
  });

  installDesktopApplicationMenu({
    menu: Menu,
    getLocale: () => app.getLocale(),
    onCheckUpdates: () => {
      if (updateCoordinator === undefined) return;
      const active = updateCoordinator;
      const activeSchedule = updateSchedule;
      void runDesktopManualUpdateCheck({
        coordinator: active,
        check: () =>
          activeSchedule !== undefined
            ? activeSchedule.check(true, true)
            : active.check(true),
        locale: resolveDesktopLocale(app.getLocale()),
        dialog,
        parentWindow: focusedOrPrimaryWindow(),
      }).catch((error: unknown) => {
        console.error(error);
      });
    },
    platform: process.platform,
  });
}

async function bootstrapDesktopUpdates(): Promise<void> {
  const feedEnabled = (): boolean =>
    isDesktopUpdateFeedEnabled({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      forceEnable: process.env.XRK_DESKTOP_UPDATE_FORCE === "1",
    });

  const unsignedFeed = existsSync(
    path.join(process.resourcesPath, "unsigned-update.json"),
  );
  const electronUpdater = await tryCreateDesktopElectronUpdater(
    unsignedFeed ? { verifyUpdateCodeSignature: false } : {},
  );

  if (electronUpdater !== undefined) {
    updateCoordinator = new DesktopUpdateCoordinator({
      publish: broadcastUpdate,
      updater: electronUpdater,
      enabled: feedEnabled,
      currentVersion: () => app.getVersion(),
      beforeRestart: async () => {
        const host = desktopHost;
        desktopHost = undefined;
        if (host !== undefined) await host.stop();
      },
    });
    if (feedEnabled()) {
      try {
        updateSchedule = new DesktopUpdateSchedule(
          updateCoordinator,
          resolveDesktopUpdateScheduleConfig(process.env),
        );
        void updateSchedule.check(false, true).catch((error: unknown) => {
          console.error(error);
        });
      } catch (error) {
        console.error(error);
      }
    }
  }
}

export { ownsDesktopInstance };
