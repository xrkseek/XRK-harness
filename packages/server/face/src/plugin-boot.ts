/**
 * Shared client-plugin boot overlay reconcile (CLI + Face + Host).
 * Soft-disable disk I/O lives in `@xrkseek/server-loader` (shared leaf).
 * Boot writer stays here: content-stable rev + atomic replace.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  atomicWriteText,
  canonicalizeDisabledPluginIdsAt,
  isPluginSoftDisabledAt,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  writeDisabledPluginIdsAt,
} from "@xrkseek/server-loader";

export { atomicWriteText } from "@xrkseek/server-loader";

export interface ClientBootEntry {
  readonly id: string;
  readonly url: string;
  readonly rev: string;
  readonly inject: readonly string[];
  readonly immediately?: boolean;
}

export interface ClientBootReconcileResult {
  readonly rev: string;
  readonly entries: readonly ClientBootEntry[];
  /** False when on-disk boot already matched (no rewrite / no cache bust). */
  readonly wrote: boolean;
  /** True when disabled file was rewritten (orphan prune and/or canonicalize). */
  readonly prunedDisabled: boolean;
}

function entriesFingerprint(entries: readonly ClientBootEntry[]): string {
  return createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")
    .slice(0, 16);
}

function sameEntries(
  a: readonly ClientBootEntry[] | undefined,
  b: readonly ClientBootEntry[],
): boolean {
  if (!a || a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Rewrite `{pluginsDir}/web/boot.json` from `.xrk-plugins.json` client rows,
 * omitting soft-disabled ids and pruning/canonicalizing the disabled file.
 */
export function reconcileClientBootAt(
  pluginsDir: string,
): ClientBootReconcileResult {
  const root = path.resolve(pluginsDir);
  const index = readManagedPackageIndexAt(root);
  const disabled = readDisabledPluginIdsAt(root);
  const packages = readManagedPluginPackagesAt(root);
  const entries: ClientBootEntry[] = [];

  for (const [name, entry] of packages) {
    if (entry.kind !== "client" && entry.kind !== "both") continue;
    if (isPluginSoftDisabledAt(name, disabled, index)) continue;
    entries.push({
      id: name,
      url: `/plugins/${name}/client.js`,
      rev: entry.version ?? "0",
      inject: entry.clientInject ?? [],
      ...(entry.clientImmediately ? { immediately: true } : {}),
    });
  }

  const prunedDisabled = canonicalizeDisabledPluginIdsAt(
    root,
    disabled,
    index,
  );
  if (prunedDisabled) writeDisabledPluginIdsAt(root, disabled);

  entries.sort((a, b) => a.id.localeCompare(b.id));
  const webDir = path.join(root, "web");
  const bootPath = path.join(webDir, "boot.json");

  if (entries.length === 0) {
    if (existsSync(bootPath)) {
      rmSync(bootPath, { force: true });
      return {
        rev: `xrk-plugins-empty`,
        entries,
        wrote: true,
        prunedDisabled,
      };
    }
    return {
      rev: `xrk-plugins-empty`,
      entries,
      wrote: false,
      prunedDisabled,
    };
  }

  let previous:
    | { rev?: string; entries?: ClientBootEntry[] }
    | undefined;
  if (existsSync(bootPath)) {
    try {
      previous = JSON.parse(readFileSync(bootPath, "utf8")) as {
        rev?: string;
        entries?: ClientBootEntry[];
      };
    } catch {
      previous = undefined;
    }
  }

  if (sameEntries(previous?.entries, entries)) {
    return {
      rev:
        typeof previous?.rev === "string" && previous.rev
          ? previous.rev
          : `xrk-plugins-${entriesFingerprint(entries)}`,
      entries,
      wrote: false,
      prunedDisabled,
    };
  }

  const rev = `xrk-plugins-${entriesFingerprint(entries)}`;
  mkdirSync(webDir, { recursive: true });
  atomicWriteText(
    bootPath,
    `${JSON.stringify({ rev, entries }, null, 2)}\n`,
  );
  return { rev, entries, wrote: true, prunedDisabled };
}
