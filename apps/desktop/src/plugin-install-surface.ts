/**
 * Desktop plugin install surface (ADR-0008) — design contract.
 *
 * Structured operations only: list / add / remove / update.
 * Package mutations map to fixed bundled-pnpm argv; callers never pass
 * arbitrary CLI flags or free-form argv.
 *
 * Ready gate stays false until a profile pnpm executor is wired
 * (`isDesktopPluginInstallReady()`). Preload exposure remains phase 2.
 */

/** Installed desktop plugin row derived from the desktop profile. */
export interface DesktopPluginRecord {
  readonly name: string;
  readonly version: string;
}

/**
 * Structured mutation requests. No `extraArgs` / raw argv fields —
 * Main builds the exact pnpm command internally.
 */
export type DesktopPluginMutation =
  | { readonly type: "add"; readonly spec: string }
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "update"; readonly name: string; readonly version: string };

/** Named operations on the install surface (≠ CLI `xrkh plugin`). */
export const DESKTOP_PLUGIN_INSTALL_OPERATIONS = [
  "list",
  "add",
  "remove",
  "update",
] as const;

export type DesktopPluginInstallOperation =
  (typeof DESKTOP_PLUGIN_INSTALL_OPERATIONS)[number];

/**
 * Boundary vs other plugin surfaces (design decision).
 * Desktop install ≠ CLI plugins dir / web overlay ≠ dsh-compat ≠ Host sidebar.
 */
export const DESKTOP_PLUGIN_INSTALL_BOUNDARY = {
  /** Mutations target the reserved desktop profile via bundled pnpm. */
  owner: "desktop-profile" as const,
  /** Shared product Settings stay in Settings UI; activation stays desktop-local. */
  sharedProductData: "settings-only" as const,
  /** CLI plugin dir / CLI node_modules are not the Desktop executable graph. */
  notCliPluginsDir: true as const,
  /**
   * CLI `web/boot.json` + staged `client.js` overlay is for Web/CLI Host only —
   * not Desktop preload plugin CRUD and not desktop profile deps.
   */
  notCliWebBootOverlay: true as const,
  /** Community client / dsh-compat path shapes are unrelated to this surface. */
  notDshCompatCapabilityTable: true as const,
  /** Host-native `/sidebar/*` is not a plugin-install channel. */
  notHostSidebarSurface: true as const,
} as const;

const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

/** Validate an npm package name used as remove/update identity. */
export function assertDesktopPluginPackageName(name: string): string {
  if (!PACKAGE_NAME_PATTERN.test(name)) {
    throw new Error(
      `xrk desktop plugins: invalid npm package name ${JSON.stringify(name)}`,
    );
  }
  return name;
}

/** Validate an exact version / tag segment for update or `name@version` specs. */
export function assertDesktopPluginVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(
      `xrk desktop plugins: invalid exact version ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/**
 * Validate one registry package spec for `add`.
 * Allows `name` or `name@version` (scoped or unscoped).
 * Rejects paths, URLs, file:/git: specs, whitespace, and leading dashes
 * (so callers cannot smuggle pnpm flags).
 *
 * @returns explicit package name when present in the spec
 */
export function assertDesktopPluginAddSpec(spec: string): string {
  if (
    spec === "" ||
    spec.startsWith("-") ||
    /[\s\\]/u.test(spec) ||
    spec.includes("://") ||
    spec.startsWith("file:") ||
    spec.startsWith("link:") ||
    spec.startsWith("git+") ||
    spec.startsWith("github:")
  ) {
    throw new Error(
      `xrk desktop plugins: unsupported npm package spec ${JSON.stringify(spec)}`,
    );
  }
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) {
      throw new Error(
        `xrk desktop plugins: invalid scoped package spec ${JSON.stringify(spec)}`,
      );
    }
    const versionAt = spec.indexOf("@", slash);
    const name = versionAt === -1 ? spec : spec.slice(0, versionAt);
    assertDesktopPluginPackageName(name);
    if (versionAt !== -1) assertDesktopPluginVersion(spec.slice(versionAt + 1));
    return name;
  }
  const versionAt = spec.indexOf("@");
  const name = versionAt === -1 ? spec : spec.slice(0, versionAt);
  assertDesktopPluginPackageName(name);
  if (versionAt !== -1) assertDesktopPluginVersion(spec.slice(versionAt + 1));
  return name;
}

/** Validate a structured mutation before any process spawn. */
export function assertDesktopPluginMutation(
  mutation: DesktopPluginMutation,
): DesktopPluginMutation {
  switch (mutation.type) {
    case "add":
      assertDesktopPluginAddSpec(mutation.spec);
      return mutation;
    case "remove":
      assertDesktopPluginPackageName(mutation.name);
      return mutation;
    case "update":
      assertDesktopPluginPackageName(mutation.name);
      assertDesktopPluginVersion(mutation.version);
      return mutation;
    default: {
      const _exhaustive: never = mutation;
      throw new Error(
        `xrk desktop plugins: unknown mutation ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Fixed argv for bundled pnpm. Never appends caller-supplied flags.
 * Executor (when wired) must prepend only Desktop-owned config
 * (`--config.store-dir=…`, etc.), never merge arbitrary args.
 */
export function desktopPluginPnpmArgv(
  mutation: DesktopPluginMutation,
): readonly string[] {
  const safe = assertDesktopPluginMutation(mutation);
  switch (safe.type) {
    case "add":
      return ["add", safe.spec, "--save-exact"];
    case "remove":
      return ["remove", safe.name];
    case "update":
      return ["add", `${safe.name}@${safe.version}`, "--save-exact"];
    default: {
      const _exhaustive: never = safe;
      throw new Error(
        `xrk desktop plugins: unknown mutation ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Product readiness for Desktop plugin install.
 * Design + validators only — no profile pnpm executor yet.
 */
export function isDesktopPluginInstallReady(): false {
  return false;
}
