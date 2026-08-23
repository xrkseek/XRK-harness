/**
 * dsh-better-sidebar prefs — file-backed under ~/.xrk/sidebar/prefs.json
 */
import { createXrkDocStore } from "./underlying/doc-store.js";

export const SIDEBAR_PREFS_DEFAULT: Record<string, unknown> = {
  openByDefault: false,
  defaultWidthPercent: 35,
  autoOpenSubagent: true,
  autoOpenJobs: true,
  agentTerminalTools: false,
  bottomPanelAutoTerminal: true,
  terminalFontFamily: "",
  terminalFontSize: 13,
  interceptOpenPath: true,
  editorExplorer: false,
  terminalShell: "",
  terminalShellArgs: "",
  titleBarScheme: "auto",
  titleBarPresetId: "",
  customCss: "",
  titleBarCompat: false,
  titleBarStripPx: 40,
  htmlViewerNoSandbox: false,
  htmlViewerDefaultUnsafe: false,
  browserNoSandbox: false,
  browserInterceptLinks: true,
  browserInterceptHttp: true,
  browserInterceptHttps: false,
  tabsEnabled: {},
  viewersEnabled: {},
  pluginSettings: {},
};

const PREFS_STORE = createXrkDocStore(
  ["sidebar", "prefs.json"],
  { ...SIDEBAR_PREFS_DEFAULT },
);

export interface PrefsFile {
  revision: number;
  value: Record<string, unknown>;
}

export function loadSidebarPrefs(xrkHome?: string): PrefsFile {
  const doc = PREFS_STORE.read(xrkHome);
  return {
    revision: doc.revision,
    value: { ...SIDEBAR_PREFS_DEFAULT, ...doc.data },
  };
}

export function saveSidebarPrefs(
  xrkHome: string | undefined,
  value: Record<string, unknown>,
  _revision?: number,
): number {
  const merged = { ...SIDEBAR_PREFS_DEFAULT, ...value };
  return PREFS_STORE.write(xrkHome, merged).revision;
}

export function patchSidebarPrefs(
  xrkHome: string | undefined,
  patch: Record<string, unknown>,
): PrefsFile {
  const doc = PREFS_STORE.patch(xrkHome, (current) => ({
    ...SIDEBAR_PREFS_DEFAULT,
    ...current,
    ...patch,
  }));
  return {
    revision: doc.revision,
    value: { ...SIDEBAR_PREFS_DEFAULT, ...doc.data },
  };
}
