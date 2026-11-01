#!/usr/bin/env node
/**
 * Prune local (gitignored) packaging / release caches to a fixed layout.
 *
 * Retention: keep at most KEEP newest semver snapshots per series.
 *
 *   pnpm prune:local
 *   pnpm prune:local -- --keep 5
 *   pnpm prune:local -- --dry-run
 *   pnpm prune:local -- --junk   # also drop .release one-off logs/scripts
 */
import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, ".release");
const DESKTOP_BUILD = path.join(ROOT, "apps", "desktop", ".desktop-build");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    keep: { type: "string", default: "5" },
    "dry-run": { type: "boolean", default: false },
    junk: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(
    "prune-local-artifacts: retain ≤N local version snapshots\n" +
      "  --keep <n>   default 5\n" +
      "  --dry-run    print only\n" +
      "  --junk       remove .release ad-hoc logs/scripts (keep tgz + stage trees)\n",
  );
  process.exit(0);
}

const KEEP = Math.max(1, Number.parseInt(values.keep, 10) || 5);
const DRY = values["dry-run"] === true;

/** @param {string} v */
function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? "",
  };
}

/** @param {string} a @param {string} b */
function cmpSemverDesc(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return b.localeCompare(a);
  if (!pa) return 1;
  if (!pb) return -1;
  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  if (pa.patch !== pb.patch) return pb.patch - pa.patch;
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return -1; // release > prerelease
  if (!pb.pre) return 1;
  return pb.pre.localeCompare(pa.pre);
}

/** @param {string} p */
function removePath(p) {
  if (!existsSync(p)) return false;
  if (DRY) {
    process.stdout.write(`dry-run: ${path.relative(ROOT, p)}\n`);
    return true;
  }
  const st = statSync(p);
  if (st.isDirectory()) rmSync(p, { recursive: true, force: true });
  else unlinkSync(p);
  process.stdout.write(`removed: ${path.relative(ROOT, p)}\n`);
  return true;
}

/** @param {string} dir */
function dirHasFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isFile() && st.size > 0) return true;
    if (st.isDirectory() && dirHasFiles(full)) return true;
  }
  return false;
}

/**
 * @param {{ id: string, path: string }[]} items
 * @param {number} keep
 */
function pruneSeries(items, keep) {
  let n = 0;
  // Empty snapshot *dirs* never count toward the retention budget.
  // Files (tarballs) always count.
  const keepCandidates = [];
  for (const item of items) {
    let st;
    try {
      st = statSync(item.path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (dirHasFiles(item.path)) keepCandidates.push(item);
      else if (removePath(item.path)) n += 1;
    } else {
      keepCandidates.push(item);
    }
  }
  const sorted = keepCandidates.sort((a, b) => cmpSemverDesc(a.id, b.id));
  for (const item of sorted.slice(keep)) {
    if (removePath(item.path)) n += 1;
  }
  return n;
}

let removed = 0;

// --- .release npm tarballs ---
if (existsSync(RELEASE)) {
  /** @type {Map<string, { id: string, path: string }[]>} */
  const tgzSeries = new Map();
  for (const name of readdirSync(RELEASE)) {
    const m = name.match(/^(xrkseek-harness(?:-cli)?)-(.+)\.tgz$/);
    if (!m) continue;
    const series = m[1];
    const id = m[2];
    if (!parseSemver(id)) continue;
    const list = tgzSeries.get(series) ?? [];
    list.push({ id, path: path.join(RELEASE, name) });
    tgzSeries.set(series, list);
  }
  for (const list of tgzSeries.values()) removed += pruneSeries(list, KEEP);

  /** @type {Map<string, { id: string, path: string }[]>} */
  const dirSeries = new Map([
    ["desktop-feed", []],
    ["agt", []],
    ["from-server", []],
    ["desktop", []],
  ]);
  for (const name of readdirSync(RELEASE)) {
    const full = path.join(RELEASE, name);
    if (!statSync(full).isDirectory()) continue;
    let kind = "";
    let id = "";
    if (name.startsWith("desktop-feed-")) {
      kind = "desktop-feed";
      id = name.slice("desktop-feed-".length);
    } else if (name.startsWith("agt-") && parseSemver(name.slice(4))) {
      kind = "agt";
      id = name.slice(4);
    } else if (name.startsWith("from-server-")) {
      kind = "from-server";
      id = name.slice("from-server-".length);
    } else if (name.startsWith("desktop-") && parseSemver(name.slice(8))) {
      kind = "desktop";
      id = name.slice(8);
    } else if (
      existsSync(path.join(RELEASE, "desktop")) &&
      name === "desktop"
    ) {
      // nested .release/desktop/<ver> handled below
      continue;
    }
    if (!kind || !parseSemver(id)) continue;
    dirSeries.get(kind).push({ id, path: full });
  }
  for (const list of dirSeries.values()) {
    if (list.length) removed += pruneSeries(list, KEEP);
  }

  const desktopRoot = path.join(RELEASE, "desktop");
  if (existsSync(desktopRoot) && statSync(desktopRoot).isDirectory()) {
    const nested = [];
    for (const name of readdirSync(desktopRoot)) {
      if (!parseSemver(name)) continue;
      nested.push({ id: name, path: path.join(desktopRoot, name) });
    }
    removed += pruneSeries(nested, KEEP);
  }

  if (values.junk) {
    /** Canonical top-level names under .release/; everything else is scratch. */
    for (const name of readdirSync(RELEASE)) {
      if (name === "harness" || name === "harness-cli" || name === "desktop") {
        continue;
      }
      if (/^xrkseek-harness(?:-cli)?-.+\.tgz$/.test(name)) continue;
      // Versioned dirs only — do not treat agt-upload-*.log as agt-<ver>.
      if (
        name.startsWith("desktop-feed-") &&
        parseSemver(name.slice("desktop-feed-".length))
      ) {
        continue;
      }
      if (
        name.startsWith("from-server-") &&
        parseSemver(name.slice("from-server-".length))
      ) {
        continue;
      }
      if (name.startsWith("agt-") && parseSemver(name.slice(4))) {
        continue;
      }
      if (removePath(path.join(RELEASE, name))) removed += 1;
    }
  }
}

/**
 * Inside a working artifacts dir, keep ≤KEEP newest
 * `xrk-harness-<ver>-…` version groups; drop older exe/blockmap.
 * @param {string} dir
 */
function pruneArtifactFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  /** @type {Map<string, string[]>} */
  const byVer = new Map();
  for (const name of readdirSync(dir)) {
    const m = name.match(/^xrk-harness-(.+?)-win-/);
    if (!m) continue;
    const id = m[1];
    if (!parseSemver(id)) continue;
    const list = byVer.get(id) ?? [];
    list.push(path.join(dir, name));
    byVer.set(id, list);
  }
  const versions = [...byVer.keys()].sort(cmpSemverDesc);
  let n = 0;
  for (const id of versions.slice(KEEP)) {
    for (const p of byVer.get(id) ?? []) {
      if (removePath(p)) n += 1;
    }
  }
  // Unpack dir is rebuildable and large; keep only when current slot has ≤KEEP exes.
  const unpacked = path.join(dir, "win-unpacked");
  if (existsSync(unpacked) && versions.length > 0) {
    // Always drop stale unpacked trees after prune — regenerates on next package.
    if (removePath(unpacked)) n += 1;
  }
  return n;
}

// --- desktop-build versioned dirs + flat working slots ---
/** @type {{ id: string, path: string }[]} */
const uploadStages = [];
/** @type {{ id: string, path: string }[]} */
const unsignedSnapshots = [];

const targetsRoot = path.join(DESKTOP_BUILD, "targets");
if (existsSync(targetsRoot)) {
  for (const target of readdirSync(targetsRoot)) {
    const root = path.join(targetsRoot, target);
    if (!statSync(root).isDirectory()) continue;
    for (const name of readdirSync(root)) {
      const full = path.join(root, name);
      if (!statSync(full).isDirectory()) continue;
      if (name.startsWith("unsigned-artifacts-")) {
        const id = name.slice("unsigned-artifacts-".length);
        if (parseSemver(id)) unsignedSnapshots.push({ id, path: full });
      } else if (name.startsWith("upload-stage-")) {
        const id = name.slice("upload-stage-".length);
        if (parseSemver(id)) uploadStages.push({ id, path: full });
      }
    }
    removed += pruneArtifactFiles(path.join(root, "unsigned-artifacts"));
    removed += pruneArtifactFiles(path.join(root, "artifacts"));
  }
}

if (existsSync(DESKTOP_BUILD)) {
  for (const name of readdirSync(DESKTOP_BUILD)) {
    if (!name.startsWith("upload-stage-")) continue;
    const id = name.slice("upload-stage-".length);
    if (!parseSemver(id)) continue;
    uploadStages.push({ id, path: path.join(DESKTOP_BUILD, name) });
  }
}

removed += pruneSeries(unsignedSnapshots, KEEP);
removed += pruneSeries(uploadStages, KEEP);

process.stdout.write(
  DRY
    ? `prune-local-artifacts: dry-run matched ${removed} path(s); keep=${KEEP}\n`
    : `prune-local-artifacts: done removed=${removed} keep=${KEEP}\n`,
);
