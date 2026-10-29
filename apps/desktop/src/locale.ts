/** Typed English / Chinese / Japanese copy owned by the Electron shell (menus · dialogs). */

/** English is the key-set source of truth; unknown locales fall back here. */
export const en = {
  application: "Application",
  windowTitle: "XRK Harness",
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
  windowTitle: "XRK Harness",
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

export const ja = {
  application: "アプリケーション",
  windowTitle: "XRK Harness",
  startupFailed: "XRK Harness Desktop を起動できませんでした",
  checkUpdatesMenu: "更新を確認…",
  updateCheckFailedTitle: "更新の確認に失敗しました",
  unknownError: "不明なエラー",
  updateCheckTitle: "更新を確認",
  updateCurrent: "すでに最新版です。",
  updateTitle: "XRK Harness Desktop の更新",
  updateAvailable: "利用可能な更新があります",
  updateDetail:
    "XRK Harness Desktop {version}\n\nこのリリースには対応する Host と Web dist が含まれます。インストール後にアプリが再起動します。",
  installAndRestart: "インストールして再起動",
  later: "後で",
  updateFailedTitle: "更新に失敗しました",
} as const satisfies DesktopMessages;

export interface DesktopLocale {
  readonly id: "en" | "zh-CN" | "ja";
  readonly messages: DesktopMessages;
}

/** Map Chromium / OS / product locale tags onto the shipped dictionaries. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  const normalized = locale.trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return { id: "zh-CN", messages: zh };
  }
  if (normalized === "ja" || normalized.startsWith("ja-")) {
    return { id: "ja", messages: ja };
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
