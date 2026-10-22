/**
 * Choose SQLite journal_mode for the sessions directory.
 *
 * WAL needs shared-memory + mmap semantics that NFS / SMB / many sync-folder
 * volumes do not provide. Prefer DELETE there (or when XRK_SQLITE_JOURNAL
 * forces it). Local disks keep WAL.
 */

export type SqliteJournalMode = "WAL" | "DELETE";

const SYNC_FOLDER_MARKERS = [
  `${"OneDrive"}`,
  "Dropbox",
  "Google Drive",
  "iCloudDrive",
  "Box Sync",
] as const;

/**
 * Heuristic: UNC share, or a path under a common cloud-sync root.
 * Not a substitute for GetDriveType — fail closed toward DELETE when unsure
 * would hurt local SSD users, so we only flip on strong signals.
 */
export function isLikelyRemoteSessionsPath(dir: string): boolean {
  const normalized = dir.replace(/\//g, "\\");
  if (normalized.startsWith("\\\\")) return true;
  const lower = normalized.toLowerCase();
  for (const marker of SYNC_FOLDER_MARKERS) {
    if (lower.includes(`\\${marker.toLowerCase()}\\`)) return true;
  }
  return false;
}

/**
 * Resolve journal mode for `dir` (sessions root).
 * Env override: `XRK_SQLITE_JOURNAL=WAL|DELETE` (case-insensitive).
 */
export function resolveSqliteJournalMode(dir: string): SqliteJournalMode {
  const forced = process.env.XRK_SQLITE_JOURNAL?.trim().toUpperCase();
  if (forced === "WAL" || forced === "DELETE") return forced;
  return isLikelyRemoteSessionsPath(dir) ? "DELETE" : "WAL";
}
