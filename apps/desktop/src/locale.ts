/** Typed English and Chinese copy owned by the Electron shell (menus · dialogs). */

/** English is the key-set source of truth; non-zh locales fall back here. */
export const en = {
  application: "Application",
  startupFailed: "XRK Harness Desktop could not start",
  checkUpdatesMenu: "Check for Updates…",
  updateCheckFailedTitle: "Update Check Failed",
  unknownError: "Unknown error",
  updateCheckTitle: "Check for Updates",
  updateCurrent: "You already have the latest version.",
  updateTitle: "XRK Harness Desktop Update",
  updateAvailable: "An update is available",
  updateDetail:
    "XRK Harness Desktop {version}\n\nThis release includes its matching Host and Web dist. The application will restart after installation.",
  installAndRestart: "Install and Restart",
  later: "Later",
  updateFailedTitle: "Update Failed",
} as const;

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string };

export const zh = {
  application: "应用",
  startupFailed: "XRK Harness 桌面端无法启动",
  checkUpdatesMenu: "检查更新…",
  updateCheckFailedTitle: "更新检查失败",
  unknownError: "未知错误",
  updateCheckTitle: "检查更新",
  updateCurrent: "当前已是最新版本。",
  updateTitle: "XRK Harness 桌面端更新",
  updateAvailable: "发现可用更新",
  updateDetail:
    "XRK Harness Desktop {version}\n\n新版本绑定匹配的 Host 与 Web dist，安装后将重新启动。",
  installAndRestart: "安装并重启",
  later: "稍后",
  updateFailedTitle: "更新失败",
} as const satisfies DesktopMessages;

export interface DesktopLocale {
  readonly id: "en" | "zh-CN";
  readonly messages: DesktopMessages;
}

/** Map Chromium / OS locale tags onto the two shipped dictionaries. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  const normalized = locale.trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return { id: "zh-CN", messages: zh };
  }
  return { id: "en", messages: en };
}

/** Replace `{name}` placeholders; unknown keys stay literal. */
export function formatDesktopMessage(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match,
  );
}
