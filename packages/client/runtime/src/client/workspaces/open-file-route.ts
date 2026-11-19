import { isAttachmentAddress } from './path.ts'
import { isPhoneThinShell, looksLikeDirectoryPath } from './file-download.ts'

/** Scenario knobs for chat / Overview file-open (platform + surface aware). */
export interface RouteWorkspaceOpenFileOptions {
  /**
   * When false, skip Host `openPath` (SSH / headless / non-privileged Web /
   * phone browser on a public Host URL / remote Linux container viewed from
   * outside). Community workbench wake still runs when provided.
   */
  readonly allowNativeOpen?: boolean
  /**
   * Mature Web fallback (DSH: Download on Web, not fake Save-as): save the file
   * through Host `/sidebar/file?download=1` + browser / phone-shell download.
   * Called when OS open is unavailable or fails, and no workbench woke.
   */
  readonly downloadFile?: (path: string) => void | Promise<void>
}

/**
 * Thrown when this browser surface cannot OS-open a workspace path, no
 * in-app workbench woke, and download is also impossible (directory, or no
 * download hook). Callers must show UI — silent resolve caused
 * “手机访问公网点文件链接没反应”.
 */
export class NativeOpenUnavailableError extends Error {
  readonly code = 'native-open-unavailable' as const

  constructor(readonly path: string) {
    super(
      'This surface cannot open workspace files with a local app '
      + '(public / remote Host). Use a local Desktop or LAN session, '
      + 'install a workbench preview plugin, or download the file.',
    )
    this.name = 'NativeOpenUnavailableError'
  }
}

export function isNativeOpenUnavailableError(error: unknown): error is NativeOpenUnavailableError {
  return error instanceof NativeOpenUnavailableError
    || (error instanceof Error && (error as { code?: string }).code === 'native-open-unavailable')
}

async function tryDownload(
  path: string,
  downloadFile: ((path: string) => void | Promise<void>) | undefined,
): Promise<boolean> {
  if (downloadFile === undefined) return false
  if (looksLikeDirectoryPath(path)) return false
  await downloadFile(path)
  return true
}

/**
 * Open a workspace file with the cascade used by mature web agents:
 *
 * 1. Wake in-app workbench (`xrkh-better-sidebar`) when present.
 * 2. Privileged Desktop / LAN Web: OS `openPath`. Phone APK thin shell
 *    (`XrkShell`, see XRK-harness-mobile `shell_host_download.dart`) never
 *    uses guest `openPath` — even if a caller forgets `allowNativeOpen: false`.
 * 3. Soft-fail OS open after a successful wake (guest proot / missing xdg-open).
 * 4. Otherwise **download** via Host `/sidebar/file?download=1`
 *    (APK → Flutter Downloads → share / open-with sheet).
 * 5. Directories / total failure → {@link NativeOpenUnavailableError}.
 *
 * Shared by chat `openFile` and Overview Changes preview.
 */
export async function routeWorkspaceOpenFile(
  resolvedPath: string,
  openWorkspace: (path: string) => Promise<void>,
  wakeCommunity?: (path: string) => boolean | void,
  options?: RouteWorkspaceOpenFileOptions,
): Promise<void> {
  if (isAttachmentAddress(resolvedPath)) return
  const woke = wakeCommunity?.(resolvedPath) === true
  const downloadFile = options?.downloadFile
  // Defense in depth: APK thin shell always skips guest OS open (callers should
  // also pass allowNativeOpen via allowNativeWorkspaceOpen).
  const allowNative = options?.allowNativeOpen !== false && !isPhoneThinShell()

  if (allowNative) {
    try {
      await openWorkspace(resolvedPath)
      return
    } catch (err) {
      if (woke) return
      if (await tryDownload(resolvedPath, downloadFile)) return
      throw err
    }
  }

  // Public / remote / phone APK: never OS-open on the caller's device.
  if (woke) return
  if (await tryDownload(resolvedPath, downloadFile)) return
  throw new NativeOpenUnavailableError(resolvedPath)
}
