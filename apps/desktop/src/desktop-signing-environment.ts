/**
 * Desktop code-signing environment (ADR-0008 · first-wave packaging).
 * Mirrors dsh desktop-release-environment / windows-sign gates without vendoring Cordis.
 * Prep subprocesses still scrub these via {@link withoutDesktopWindowsSigningEnvironment}.
 */

/** Windows Authenticode / token signing env names (prefix also used for scrub). */
export const DESKTOP_WINDOWS_SIGNING_ENV = {
  cerFile: "XRK_DESKTOP_WINDOWS_CER_FILE",
  signTool: "XRK_DESKTOP_WINDOWS_SIGNTOOL",
  tokenPin: "XRK_DESKTOP_WINDOWS_TOKEN_PIN",
  keyContainer: "XRK_DESKTOP_WINDOWS_KEY_CONTAINER",
} as const;

/** macOS identity / notarization env names (Apple toolchain). */
export const DESKTOP_MACOS_SIGNING_ENV = {
  identity: "XRK_DESKTOP_MACOS_IDENTITY",
  appleId: "XRK_DESKTOP_MACOS_APPLE_ID",
  appleIdPassword: "XRK_DESKTOP_MACOS_APPLE_ID_PASSWORD",
  teamId: "XRK_DESKTOP_MACOS_TEAM_ID",
} as const;

/** Force unsigned Windows first-wave (`1` = unsigned; omit/0 = sign when creds present). */
export const DESKTOP_UNSIGNED_ENV = "XRK_DESKTOP_UNSIGNED" as const;

export interface DesktopWindowsSigningEnvironment {
  readonly certificateFile: string;
  readonly signTool?: string;
  readonly tokenPin?: string;
  readonly keyContainer?: string;
}

export interface DesktopMacOSSigningEnvironment {
  readonly signingIdentity: string;
  readonly appleId?: string;
  readonly appleIdPassword?: string;
  readonly teamId?: string;
}

function trimEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Whether packaging should skip Authenticode / Apple signing. */
export function isDesktopUnsignedRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[DESKTOP_UNSIGNED_ENV]?.trim();
  if (raw === undefined || raw === "") return false;
  if (raw !== "0" && raw !== "1") {
    throw new Error(
      `xrk desktop: ${DESKTOP_UNSIGNED_ENV} must be 0 or 1 (got ${JSON.stringify(raw)})`,
    );
  }
  return raw === "1";
}

/**
 * Resolve Windows signing when not unsigned.
 * Missing certificate → undefined (caller may default to unsigned on win-x64).
 */
export function resolveDesktopWindowsSigningEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DesktopWindowsSigningEnvironment | undefined {
  if (isDesktopUnsignedRequested(env)) return undefined;
  const certificateFile = trimEnv(env, DESKTOP_WINDOWS_SIGNING_ENV.cerFile);
  if (certificateFile === undefined) return undefined;
  const signTool = trimEnv(env, DESKTOP_WINDOWS_SIGNING_ENV.signTool);
  const tokenPin = trimEnv(env, DESKTOP_WINDOWS_SIGNING_ENV.tokenPin);
  const keyContainer = trimEnv(env, DESKTOP_WINDOWS_SIGNING_ENV.keyContainer);
  return {
    certificateFile,
    ...(signTool !== undefined ? { signTool } : {}),
    ...(tokenPin !== undefined ? { tokenPin } : {}),
    ...(keyContainer !== undefined ? { keyContainer } : {}),
  };
}

/**
 * Resolve macOS signing identity.
 * Hardened runtime / notarize require identity; notarize Apple-id trio is optional until credentials land.
 */
export function resolveDesktopMacOSSigningEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DesktopMacOSSigningEnvironment | undefined {
  if (isDesktopUnsignedRequested(env)) {
    throw new Error(
      "xrk desktop: unsigned packaging is Windows-only (omit XRK_DESKTOP_UNSIGNED on macOS)",
    );
  }
  const signingIdentity = trimEnv(env, DESKTOP_MACOS_SIGNING_ENV.identity);
  if (signingIdentity === undefined) return undefined;
  const appleId = trimEnv(env, DESKTOP_MACOS_SIGNING_ENV.appleId);
  const appleIdPassword = trimEnv(env, DESKTOP_MACOS_SIGNING_ENV.appleIdPassword);
  const teamId = trimEnv(env, DESKTOP_MACOS_SIGNING_ENV.teamId);
  return {
    signingIdentity,
    ...(appleId !== undefined ? { appleId } : {}),
    ...(appleIdPassword !== undefined ? { appleIdPassword } : {}),
    ...(teamId !== undefined ? { teamId } : {}),
  };
}

/** True when notarization Apple-id trio is complete. */
export function isDesktopMacOSNotarizationReady(
  signing: DesktopMacOSSigningEnvironment | undefined,
): boolean {
  return (
    signing !== undefined &&
    signing.appleId !== undefined &&
    signing.appleIdPassword !== undefined &&
    signing.teamId !== undefined
  );
}
