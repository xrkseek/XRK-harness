/**
 * Desktop update mirror ladder — same idea as mobile
 * `XRK-harness-mobile/app/lib/update/update_config.dart`:
 * GitHub Release is the source of truth; CN/SEA prefer prefix accelerators
 * (ghfast / gh-proxy) before raw github.com.
 */

export const DESKTOP_UPDATE_GITHUB_OWNER = "xrkseek" as const;
export const DESKTOP_UPDATE_GITHUB_REPO = "XRK-harness" as const;
export const DESKTOP_UPDATE_METADATA_CHANNEL = "nightly" as const;

/** electron-updater channel file under `releases/latest/download/`. */
export const DESKTOP_UPDATE_CHANNEL_YML = "nightly.yml" as const;

export const DESKTOP_UPDATE_PREFERRED_MIRROR_KEY =
  "xrk-desktop-update-mirror" as const;

export type DesktopUpdateMirrorId = "github" | "ghfast" | "gh-proxy";

export interface DesktopUpdateMirror {
  readonly id: DesktopUpdateMirrorId;
  readonly label: string;
  /** Null = GitHub provider; otherwise prefix + full https://github.com/… URL. */
  readonly prefix: string | null;
}

/** Public accelerators — same hosts as the phone App. */
export const DESKTOP_PUBLIC_UPDATE_MIRRORS: readonly DesktopUpdateMirror[] = [
  { id: "ghfast", label: "ghfast.top", prefix: "https://ghfast.top/" },
  { id: "gh-proxy", label: "gh-proxy.com", prefix: "https://gh-proxy.com/" },
];

export const DESKTOP_GITHUB_UPDATE_MIRROR: DesktopUpdateMirror = {
  id: "github",
  label: "GitHub",
  prefix: null,
};

/**
 * True when the device timezone suggests GitHub direct is often slow/blocked
 * (roughly India … Australia east — CN / SEA). Matches mobile
 * `preferGithubProxyByTimezone`.
 */
export function preferDesktopGithubProxyByTimezone(
  offsetMinutes: number = new Date().getTimezoneOffset() * -1,
): boolean {
  const lo = 5 * 60 + 30; // UTC+5:30
  const hi = 10 * 60; // UTC+10
  return offsetMinutes >= lo && offsetMinutes <= hi;
}

/** Latest-release asset directory on github.com (generic feed base). */
export function desktopGithubLatestDownloadBase(
  owner: string = DESKTOP_UPDATE_GITHUB_OWNER,
  repo: string = DESKTOP_UPDATE_GITHUB_REPO,
): string {
  return `https://github.com/${owner}/${repo}/releases/latest/download`;
}

/** Prefix rewrite: `https://ghfast.top/` + full github URL. */
export function rewriteDesktopGithubUrl(
  githubUrl: string,
  prefix: string,
): string {
  const trimmed = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${trimmed}${githubUrl.replace(/^\/+/u, "")}`;
}

/**
 * electron-updater `setFeedURL` shapes for one ladder step.
 * - github: native provider (dynamic latest tag)
 * - prefix mirrors: generic pointing at `…/releases/latest/download`
 */
export type DesktopUpdateFeedStep =
  | {
      readonly id: "github";
      readonly label: string;
      readonly kind: "github";
      readonly owner: string;
      readonly repo: string;
      readonly channel: typeof DESKTOP_UPDATE_METADATA_CHANNEL;
    }
  | {
      readonly id: DesktopUpdateMirrorId;
      readonly label: string;
      readonly kind: "generic";
      readonly url: string;
      readonly channel: typeof DESKTOP_UPDATE_METADATA_CHANNEL;
    };

export function desktopUpdateFeedStepForMirror(
  mirror: DesktopUpdateMirror,
  options: {
    readonly owner?: string;
    readonly repo?: string;
  } = {},
): DesktopUpdateFeedStep {
  const owner = options.owner ?? DESKTOP_UPDATE_GITHUB_OWNER;
  const repo = options.repo ?? DESKTOP_UPDATE_GITHUB_REPO;
  const channel = DESKTOP_UPDATE_METADATA_CHANNEL;
  if (mirror.prefix === null) {
    return {
      id: "github",
      label: mirror.label,
      kind: "github",
      owner,
      repo,
      channel,
    };
  }
  const base = desktopGithubLatestDownloadBase(owner, repo);
  return {
    id: mirror.id,
    label: mirror.label,
    kind: "generic",
    url: rewriteDesktopGithubUrl(base, mirror.prefix),
    channel,
  };
}

/**
 * Ordered mirrors: CN/SEA → accelerators then GitHub; elsewhere GitHub first.
 * Optional `preferredId` is moved to the front (phone remembers last success).
 */
export function orderedDesktopUpdateMirrors(options: {
  readonly timezoneOffsetMinutes?: number;
  readonly preferredId?: string | null;
  readonly accelerators?: readonly DesktopUpdateMirror[];
} = {}): DesktopUpdateMirror[] {
  const accelerators = options.accelerators ?? DESKTOP_PUBLIC_UPDATE_MIRRORS;
  const preferProxy = preferDesktopGithubProxyByTimezone(
    options.timezoneOffsetMinutes ?? new Date().getTimezoneOffset() * -1,
  );
  const base = preferProxy
    ? [...accelerators, DESKTOP_GITHUB_UPDATE_MIRROR]
    : [DESKTOP_GITHUB_UPDATE_MIRROR, ...accelerators];
  const preferred = options.preferredId?.trim();
  if (!preferred) return base;
  const i = base.findIndex((m) => m.id === preferred);
  if (i <= 0) return base;
  return [base[i]!, ...base.slice(0, i), ...base.slice(i + 1)];
}

/** Feed steps in check order for electron-updater. */
export function orderedDesktopUpdateFeedSteps(options: {
  readonly timezoneOffsetMinutes?: number;
  readonly preferredId?: string | null;
  readonly owner?: string;
  readonly repo?: string;
} = {}): DesktopUpdateFeedStep[] {
  return orderedDesktopUpdateMirrors(options).map((m) =>
    desktopUpdateFeedStepForMirror(m, {
      ...(options.owner !== undefined ? { owner: options.owner } : {}),
      ...(options.repo !== undefined ? { repo: options.repo } : {}),
    }),
  );
}

/** Default packaged `app-update.yml` body (GitHub provider). */
export function renderDesktopGithubAppUpdateYml(options: {
  readonly owner?: string;
  readonly repo?: string;
  readonly channel?: typeof DESKTOP_UPDATE_METADATA_CHANNEL;
} = {}): string {
  const owner = options.owner ?? DESKTOP_UPDATE_GITHUB_OWNER;
  const repo = options.repo ?? DESKTOP_UPDATE_GITHUB_REPO;
  const channel = options.channel ?? DESKTOP_UPDATE_METADATA_CHANNEL;
  return [
    "provider: github",
    `owner: ${owner}`,
    `repo: ${repo}`,
    `channel: ${channel}`,
    "updaterCacheDirName: xrk-harness-updater",
    "",
  ].join("\n");
}
