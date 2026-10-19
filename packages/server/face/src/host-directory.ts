/**
 * Face host.listDirectory / host.createDirectory — crumbs · entries · truncated.
 */

import { execFile } from "node:child_process";
import { mkdir, opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import type { FaceRpcResult } from "./types.js";

const MAX_ENTRIES = 1000;

/**
 * Windows profile junctions / special folders that `opendir` often rejects with
 * EPERM/EACCES. Hide them from browse listings so the picker does not offer
 * dead ends (e.g. localized 「开始」菜单).
 */
const WIN32_HIDDEN_PROFILE_DIRS = new Set(
  [
    "Application Data",
    "Cookies",
    "Local Settings",
    "My Documents",
    "NetHood",
    "PrintHood",
    "Recent",
    "SendTo",
    "Start Menu",
    "「开始」菜单",
    "Templates",
  ].map((name) => name.toLowerCase()),
);

function shouldHideDirent(name: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  return WIN32_HIDDEN_PROFILE_DIRS.has(name.toLowerCase());
}

function listErrorMessage(target: string, err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  if (code === "EPERM" || code === "EACCES") {
    return `cannot list ${target}: folder is protected by the OS (${code})`;
  }
  return `cannot list ${target}: ${err instanceof Error ? err.message : String(err)}`;
}

export interface DirectoryEntryView {
  readonly name: string;
  readonly path: string;
  readonly hidden: boolean;
}

export interface DirectoryListingView {
  readonly path: string;
  readonly home: string;
  readonly crumbs: readonly DirectoryEntryView[];
  readonly entries: readonly DirectoryEntryView[];
  readonly truncated: boolean;
}

/** One jump target the in-app picker offers before it opens a column. */
export interface DirectoryPlaceView {
  readonly id: string;
  readonly kind: "home" | "desktop" | "documents" | "downloads" | "drive";
  readonly label: string;
  readonly path: string;
}

/** Same predicate as DSH `fullyQualified` (browse picker). */
export function fullyQualified(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32"
    ? win32.isAbsolute(path) &&
        /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path);
}

function ancestryCrumbs(target: string): DirectoryEntryView[] {
  const crumbs: DirectoryEntryView[] = [];
  let current = target;
  for (;;) {
    const parent = dirname(current);
    crumbs.unshift({
      name: parent === current ? current : basename(current),
      path: current,
      hidden: false,
    });
    if (parent === current) return crumbs;
    current = parent;
  }
}

interface ListingCandidate {
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

function boundedInsert(
  window: ListingCandidate[],
  candidate: ListingCandidate,
  keep: number,
): boolean {
  if (window.length >= keep) {
    const last = window[window.length - 1]!;
    if (candidate.name.localeCompare(last.name) >= 0) return true;
  }
  let i = 0;
  while (i < window.length && window[i]!.name.localeCompare(candidate.name) < 0) {
    i += 1;
  }
  window.splice(i, 0, candidate);
  if (window.length > keep) {
    window.pop();
    return true;
  }
  return false;
}

async function directoryRow(
  parent: string,
  name: string,
  isDirectory: boolean,
  isSymbolicLink: boolean,
): Promise<DirectoryEntryView | null> {
  const full = join(parent, name);
  if (isSymbolicLink) {
    try {
      const st = await stat(full);
      if (!st.isDirectory()) return null;
    } catch {
      return null;
    }
  } else if (!isDirectory) {
    return null;
  }
  return {
    name,
    path: full,
    hidden: name.startsWith("."),
  };
}

async function pathIsDir(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** First existing candidate, so OneDrive-redirected profile folders still resolve. */
async function firstExistingDir(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathIsDir(candidate)) return candidate;
  }
  return undefined;
}

function windowsDriveRoots(): Promise<string[]> {
  return new Promise((resolveDrives) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }",
      ],
      { timeout: 2500, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolveDrives([]);
          return;
        }
        const roots = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^[A-Za-z]:\\?$/.test(line))
          .map((line) => (line.endsWith("\\") ? line : `${line}\\`));
        resolveDrives([...new Set(roots)].sort((a, b) => a.localeCompare(b)));
      },
    );
  });
}

type SpecialFolders = {
  desktop?: string;
  documents?: string;
  downloads?: string;
};

/**
 * Windows shell special folders (handles OneDrive / localized redirects that
 * English `~/Desktop` guesses miss). Best-effort; empty object on failure.
 */
function windowsSpecialFolders(): Promise<SpecialFolders> {
  return new Promise((resolveFolders) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference='SilentlyContinue'",
          "$d=[Environment]::GetFolderPath('Desktop')",
          "$o=[Environment]::GetFolderPath('MyDocuments')",
          "$u=[Environment]::GetFolderPath('UserProfile')",
          "$l=if($u){Join-Path $u 'Downloads'}else{''}",
          "try{$kf=(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path;if($kf){$l=$kf}}catch{}",
          "@{Desktop=$d;Documents=$o;Downloads=$l}|ConvertTo-Json -Compress",
        ].join(";"),
      ],
      { timeout: 2500, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolveFolders({});
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout).trim()) as Record<string, unknown>;
          const pick = (key: string): string | undefined => {
            const value = parsed[key];
            return typeof value === "string" && value.length > 0 ? value : undefined;
          };
          // exactOptionalPropertyTypes: omit keys rather than assign undefined.
          const out: SpecialFolders = {};
          const desktop = pick("Desktop");
          const documents = pick("Documents");
          const downloads = pick("Downloads");
          if (desktop) out.desktop = desktop;
          if (documents) out.documents = documents;
          if (downloads) out.downloads = downloads;
          resolveFolders(out);
        } catch {
          resolveFolders({});
        }
      },
    );
  });
}

/** Parse `~/.config/user-dirs.dirs` body (exported for unit coverage). */
export function parseXdgUserDirs(raw: string, home: string): SpecialFolders {
  const out: SpecialFolders = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(XDG_(?:DESKTOP|DOCUMENTS|DOWNLOAD)_DIR)="([^"]+)"/.exec(line.trim());
    if (!match) continue;
    const expanded = match[2]!
      .replaceAll("$HOME", home)
      .replace(/^~\//, `${home}/`);
    if (match[1] === "XDG_DESKTOP_DIR") out.desktop = expanded;
    else if (match[1] === "XDG_DOCUMENTS_DIR") out.documents = expanded;
    else out.downloads = expanded;
  }
  return out;
}

/** Linux XDG user-dirs (Desktop/Documents/Downloads may be relocated). */
async function xdgUserDirs(home: string): Promise<SpecialFolders> {
  try {
    const raw = await readFile(join(home, ".config", "user-dirs.dirs"), "utf8");
    return parseXdgUserDirs(raw, home);
  } catch {
    return {};
  }
}

/**
 * macOS Finder special folders via AppleScript (iCloud / relocated Documents
 * included). Best-effort; empty object when osascript is unavailable.
 */
function darwinSpecialFolders(): Promise<SpecialFolders> {
  return new Promise((resolveFolders) => {
    execFile(
      "osascript",
      [
        "-e",
        "POSIX path of (path to desktop folder)",
        "-e",
        "POSIX path of (path to documents folder)",
        "-e",
        "POSIX path of (path to downloads folder)",
      ],
      { timeout: 2500 },
      (err, stdout) => {
        if (err) {
          resolveFolders({});
          return;
        }
        resolveFolders(parseDarwinFolderPaths(String(stdout)));
      },
    );
  });
}

/** Strip trailing slash from osascript POSIX paths (exported for tests). */
export function parseDarwinFolderPaths(stdout: string): SpecialFolders {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\/$/, ""))
    .filter((line) => line.length > 0);
  const out: SpecialFolders = {};
  if (lines[0]) out.desktop = lines[0];
  if (lines[1]) out.documents = lines[1];
  if (lines[2]) out.downloads = lines[2];
  return out;
}

/** OS-resolved profile folders for the current (or injected) platform. */
export async function resolveKnownProfileFolders(
  home: string,
  platform: NodeJS.Platform = process.platform,
): Promise<SpecialFolders> {
  if (platform === "win32") return windowsSpecialFolders();
  if (platform === "darwin") return darwinSpecialFolders();
  if (platform === "linux") return xdgUserDirs(home);
  return {};
}

/** `/` plus, on macOS, each readable `/Volumes/*` mount as a drive tile. */
async function appendPosixDrivePlaces(
  places: DirectoryPlaceView[],
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (await pathIsDir("/")) {
    places.push({ id: "drive-root", kind: "drive", label: "/", path: "/" });
  }
  if (platform !== "darwin") return;
  try {
    const level = await opendir("/Volumes");
    for await (const dirent of level) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      const full = join("/Volumes", dirent.name);
      if (!(await pathIsDir(full))) continue;
      places.push({
        id: `drive-vol-${dirent.name}`,
        kind: "drive",
        label: dirent.name,
        path: full,
      });
    }
  } catch {
    /* no /Volumes or unreadable */
  }
}

/**
 * Ordered path candidates for a profile folder. OS-resolved paths (Known
 * Folder / XDG) come first; English + localized + OneDrive guesses follow so
 * redirected or non-English profiles still land a tile.
 */
export function profileFolderCandidates(
  home: string,
  kind: "desktop" | "documents" | "downloads",
  known?: string,
): string[] {
  const names =
    kind === "desktop"
      ? ["Desktop", "桌面"]
      : kind === "documents"
        ? ["Documents", "文档", "My Documents"]
        : ["Downloads", "下载"];
  const out: string[] = [];
  const push = (candidate: string): void => {
    if (candidate.length > 0 && !out.includes(candidate)) out.push(candidate);
  };
  if (known) push(known);
  for (const name of names) {
    push(join(home, name));
    push(join(home, "OneDrive", name));
  }
  return out;
}

/**
 * Places the picker shows before a column: home, well-known profile folders
 * that exist (OS Known Folder / XDG when available), and filesystem roots.
 * Absent path pieces are omitted.
 */
export async function hostListDirectoryPlaces(): Promise<
  FaceRpcResult<{ places: DirectoryPlaceView[] }>
> {
  const home = homedir();
  const places: DirectoryPlaceView[] = [];
  if (await pathIsDir(home)) {
    places.push({ id: "home", kind: "home", label: "Home", path: home });
  }
  // Desktop Host and web Host share this path: local Face, no directoryBackend.
  const known = await resolveKnownProfileFolders(home);
  const folders: Array<{
    id: string;
    kind: "desktop" | "documents" | "downloads";
    label: string;
  }> = [
    { id: "desktop", kind: "desktop", label: "Desktop" },
    { id: "documents", kind: "documents", label: "Documents" },
    { id: "downloads", kind: "downloads", label: "Downloads" },
  ];
  for (const folder of folders) {
    const found = await firstExistingDir(
      profileFolderCandidates(home, folder.kind, known[folder.kind]),
    );
    if (found) {
      places.push({
        id: folder.id,
        kind: folder.kind,
        label: folder.label,
        path: found,
      });
    }
  }
  if (process.platform === "win32") {
    const roots = await windowsDriveRoots();
    const usable = roots.length > 0 ? roots : (await pathIsDir("C:\\") ? ["C:\\"] : []);
    for (const root of usable) {
      const letter = root.slice(0, 1).toUpperCase();
      places.push({ id: `drive-${letter}`, kind: "drive", label: `${letter}:`, path: root });
    }
  } else {
    await appendPosixDrivePlaces(places);
  }
  return { ok: true, value: { places } };
}

export async function hostListDirectory(
  payload: unknown,
): Promise<FaceRpcResult<DirectoryListingView>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const rawPath = typeof p.path === "string" ? p.path : undefined;
  const home = homedir();
  if (rawPath !== undefined && !fullyQualified(rawPath)) {
    return {
      ok: false,
      error: {
        code: "directory-unreadable",
        message: `cannot list "${rawPath}": not a fully qualified path`,
      },
    };
  }
  const target = resolve(rawPath ?? home);
  const keep = MAX_ENTRIES + 1;
  const window: ListingCandidate[] = [];
  let evicted = false;
  try {
    const level = await opendir(target);
    for await (const dirent of level) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
      if (shouldHideDirent(dirent.name, process.platform)) continue;
      if (
        boundedInsert(
          window,
          {
            name: dirent.name,
            isDirectory: dirent.isDirectory(),
            isSymbolicLink: dirent.isSymbolicLink(),
          },
          keep,
        )
      ) {
        evicted = true;
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "directory-unreadable",
        message: listErrorMessage(target, err),
      },
    };
  }

  const entries: DirectoryEntryView[] = [];
  let truncated = evicted;
  for (const candidate of window) {
    const row = await directoryRow(
      target,
      candidate.name,
      candidate.isDirectory,
      candidate.isSymbolicLink,
    );
    if (row === null) continue;
    if (entries.length === MAX_ENTRIES) {
      truncated = true;
      break;
    }
    entries.push(row);
  }

  return {
    ok: true,
    value: {
      path: target,
      home,
      crumbs: ancestryCrumbs(target),
      entries,
      truncated,
    },
  };
}

export async function hostCreateDirectory(
  payload: unknown,
): Promise<FaceRpcResult<{ path: string }>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const parent = typeof p.path === "string" ? p.path.trim() : "";
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (
    !parent ||
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\]/.test(name)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message:
          "path required; name must be a single non-blank path segment",
      },
    };
  }
  if (!fullyQualified(parent)) {
    return {
      ok: false,
      error: {
        code: "directory-unreadable",
        message: `cannot create under "${parent}": not a fully qualified path`,
      },
    };
  }
  const full = join(resolve(parent), name);
  try {
    await mkdir(full, { recursive: false });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "directory-create-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  return { ok: true, value: { path: full } };
}
