/**
 * Browser / phone-shell download helpers for workspace files.
 *
 * Mature web agents (DSH file-actions): Web offers **Download**, never a fake
 * OS “Save as”; Desktop may still OS-open. XRK Host already streams workspace
 * bytes at `GET /sidebar/file?download=1` — reuse that instead of inventing a
 * second file API.
 *
 * Phone thin shell (`XrkShell`): Android WebView ignores `<a download>` and
 * cannot HTTP-GET `blob:` / `data:` URLs. Same-origin http(s) → `{op:'download'}`;
 * object URLs → `{op:'downloadBytes', base64}` after a same-document fetch.
 */

/** Host origin for same-origin downloads (null-origin carriers → internal). */
function hostOrigin(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://xrk.internal'
}

type XrkShellPort = { readonly postMessage?: (raw: string) => void }

function xrkShell(): XrkShellPort | undefined {
  return (globalThis as { XrkShell?: XrkShellPort }).XrkShell
}

/** Basename safe for Content-Disposition / XrkShell filename. */
export function basenameForDownload(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const base = trimmed.split(/[/\\]/).pop()?.trim()
  return base && base.length > 0 && base !== '.' ? base : 'download.bin'
}

/**
 * Paths that must not hit `/sidebar/file` (Host returns not-file).
 * Chat “open workspace folder” uses `.`.
 */
export function looksLikeDirectoryPath(path: string): boolean {
  const t = path.trim()
  return t === '.' || t === './' || t === '/' || t.endsWith('/') || t.endsWith('\\')
}

/** True when the URL is a document-local object / data URL (not HTTP-fetchable by the shell). */
export function isObjectDownloadUrl(url: string): boolean {
  const t = url.trim().toLowerCase()
  return t.startsWith('blob:') || t.startsWith('data:')
}

/**
 * Build the Host download URL for one workspace file.
 * @param path - absolute or cwd-relative path (same spelling as openPath).
 * @param sessionId - optional Session so Host can resolve cwd.
 * @param cwd - optional cwd override when Session id is absent.
 */
export function workspaceFileDownloadUrl(
  path: string,
  options?: { readonly sessionId?: string; readonly cwd?: string },
): string {
  const url = new URL('/sidebar/file', hostOrigin())
  url.searchParams.set('path', path)
  url.searchParams.set('download', '1')
  const sessionId = options?.sessionId?.trim()
  if (sessionId) url.searchParams.set('sessionId', sessionId)
  const cwd = options?.cwd?.trim()
  if (cwd) url.searchParams.set('cwd', cwd)
  return url.toString()
}

/** Encode bytes as base64 without spreading into a single call (large MD / ZIP). */
export function bytesToBase64(bytes: Uint8Array): string {
  const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa
  if (typeof btoaFn !== 'function') {
    throw new Error('base64 encoding is unavailable in this carrier')
  }
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoaFn(binary)
}

async function postObjectUrlToShell(
  shell: XrkShellPort,
  url: string,
  filename: string,
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Object URL fetch failed: HTTP ${res.status}`)
  }
  const blob = await res.blob()
  const buffer = await blob.arrayBuffer()
  const mime = (blob.type || 'application/octet-stream').split(';')[0]?.trim() || 'application/octet-stream'
  shell.postMessage?.(JSON.stringify({
    op: 'downloadBytes',
    filename,
    mime,
    base64: bytesToBase64(new Uint8Array(buffer)),
  }))
}

/**
 * Hand a same-origin URL (or blob:/data: object URL) to the browser download
 * manager, or to the phone thin shell (`XrkShell`) when injected. Desktop /
 * ordinary browsers never get `XrkShell` — they keep `<a download>`.
 */
export function triggerBrowserOrShellDownload(url: string, filename: string): void {
  const shell = xrkShell()
  if (typeof shell?.postMessage === 'function') {
    if (isObjectDownloadUrl(url)) {
      void postObjectUrlToShell(shell, url, filename).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        shell.postMessage?.(JSON.stringify({
          op: 'downloadError',
          message,
          filename,
        }))
      })
      return
    }
    shell.postMessage(JSON.stringify({ op: 'download', url, filename }))
    return
  }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

/** Download one workspace file through Host `/sidebar/file?download=1`. */
export function downloadWorkspaceFile(
  path: string,
  options?: { readonly sessionId?: string; readonly cwd?: string },
): void {
  if (looksLikeDirectoryPath(path)) {
    throw new Error('Directories cannot be downloaded; browse Workspace files instead.')
  }
  const filename = basenameForDownload(path)
  triggerBrowserOrShellDownload(workspaceFileDownloadUrl(path, options), filename)
}
