/**
 * Mirror awesome-dsh-plugin.com catalog + npm-pack every package that has `npm`.
 * Local tree is searchable for adaptation (client.js HTTP / seats / inject).
 *
 * Default root: %USERPROFILE%/.xrk/community-plugin-mirror (or $HOME/…).
 * Override: XRK_COMMUNITY_MIRROR=/path  or  node scripts/dsh-community-mirror.mjs /path
 *
 *   node scripts/dsh-community-mirror.mjs           # resume full mirror
 *   node scripts/dsh-community-mirror.mjs --limit=50
 *   node scripts/dsh-community-mirror.mjs --search=hud
 *   node scripts/dsh-community-mirror.mjs --concurrency=6
 *
 * Layout:
 *   catalog.json          raw awesome catalog
 *   index.json            searchable rows (name, npm, url, status, httpPaths…)
 *   packs/<safe-id>/      extracted npm pack (package/)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AWESOME_URL = "https://awesome-dsh-plugin.com/plugins.json";
const DEFAULT_ROOT = path.join(
  process.env.USERPROFILE || process.env.HOME || os.homedir(),
  ".xrk",
  "community-plugin-mirror",
);

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const root =
  positional[0] ||
  process.env.XRK_COMMUNITY_MIRROR ||
  DEFAULT_ROOT;
const limit = Number(argValue("--limit=") || "0") || 0;
const concurrency = Math.max(1, Number(argValue("--concurrency=") || "6") || 6);
const searchOnly = argValue("--search=");
const catalogOnly = process.argv.includes("--catalog-only");

function safeId(npm) {
  return String(npm)
    .replace(/^@/, "")
    .replace(/\//g, "__")
    .replace(/[^a-zA-Z0-9._+-]+/g, "_");
}

function extractHttpPaths(clientJs) {
  if (!clientJs || !fs.existsSync(clientJs)) return [];
  const text = fs.readFileSync(clientJs, "utf8");
  const found = new Set();
  const re = /["'`](\/(?:api\/)?[a-zA-Z0-9][\w./-]{1,120})["'`]/g;
  let m;
  while ((m = re.exec(text))) {
    const p = m[1];
    if (p.includes("${") || p.length > 120) continue;
    if (
      p.startsWith("/node_modules") ||
      p.startsWith("/@") ||
      p.endsWith(".js") ||
      p.endsWith(".css") ||
      p.endsWith(".map")
    ) {
      continue;
    }
    found.add(p.split("?")[0]);
  }
  return [...found].sort();
}

function findClientJs(pkgRoot) {
  const candidates = [
    path.join(pkgRoot, "client.js"),
    path.join(pkgRoot, "lib", "client.js"),
    path.join(pkgRoot, "dist", "client.js"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // shallow walk
  try {
    for (const e of fs.readdirSync(pkgRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "node_modules") continue;
      const nested = path.join(pkgRoot, e.name, "client.js");
      if (fs.existsSync(nested)) return nested;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

async function fetchCatalog() {
  const res = await fetch(AWESOME_URL, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  return res.json();
}

function safeRmSync(target) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      const code = err && typeof err === "object" ? err.code : "";
      if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

function npmPack(npmName, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "xrk-mirror-pack-"));
  try {
    const r = spawnSync(
      "npm",
      ["pack", npmName, "--pack-destination", stage],
      {
        encoding: "utf8",
        shell: process.platform === "win32",
        timeout: 180_000,
      },
    );
    if ((r.status ?? 1) !== 0) {
      return {
        ok: false,
        error: (r.stderr || r.stdout || r.error?.message || "pack failed").trim().slice(0, 400),
      };
    }
    const tgz = fs.readdirSync(stage).find((n) => n.endsWith(".tgz"));
    if (!tgz) return { ok: false, error: "no tarball" };
    const extractDir = path.join(destDir, "_extract");
    try {
      safeRmSync(extractDir);
    } catch (err) {
      return {
        ok: false,
        error: `rm _extract: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400),
      };
    }
    fs.mkdirSync(extractDir, { recursive: true });
    const tarBin = process.platform === "win32" ? "tar.exe" : "tar";
    const tar = spawnSync(
      tarBin,
      ["-xzf", path.join(stage, tgz), "-C", extractDir],
      { encoding: "utf8" },
    );
    if ((tar.status ?? 1) !== 0) {
      return {
        ok: false,
        error: (tar.stderr || tar.stdout || "extract failed").trim().slice(0, 400),
      };
    }
    const packageRoot = path.join(extractDir, "package");
    if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
      return { ok: false, error: "missing package/" };
    }
    const finalRoot = path.join(destDir, "package");
    try {
      safeRmSync(finalRoot);
      fs.renameSync(packageRoot, finalRoot);
      safeRmSync(extractDir);
    } catch (err) {
      return {
        ok: false,
        error: `finalize: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400),
      };
    }
    try {
      fs.copyFileSync(path.join(stage, tgz), path.join(destDir, tgz));
    } catch {
      /* optional */
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `npmPack: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400),
    };
  } finally {
    try {
      safeRmSync(stage);
    } catch {
      /* best-effort */
    }
  }
}

function loadIndex() {
  const p = path.join(root, "index.json");
  if (!fs.existsSync(p)) return { updatedAt: null, packages: {} };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { updatedAt: null, packages: {} };
  }
}

function saveIndex(index) {
  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(root, "index.json"), JSON.stringify(index, null, 2));
}

async function mapPool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const cur = i++;
      await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
}

async function main() {
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "packs"), { recursive: true });

  console.log("mirror root:", root);
  console.log("fetch catalog…");
  const catalog = await fetchCatalog();
  fs.writeFileSync(
    path.join(root, "catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  console.log("catalog plugins:", plugins.length);

  const index = loadIndex();
  if (!index.packages) index.packages = {};

  // Seed index rows from catalog (even before pack).
  for (const p of plugins) {
    const npm = typeof p.npm === "string" && p.npm.trim() ? p.npm.trim() : null;
    const name = typeof p.name === "string" ? p.name : "";
    const key = npm || name;
    if (!key) continue;
    const prev = index.packages[key] || {};
    index.packages[key] = {
      ...prev,
      name,
      npm,
      url: p.url || null,
      version: p.version || null,
      category: p.category || null,
      downloads: p.downloads ?? null,
      stars: p.stars ?? null,
      description:
        typeof p.description === "object"
          ? p.description.zh || p.description.en || null
          : p.description || null,
      status: prev.status || (npm ? "pending" : "no-npm"),
    };
  }
  saveIndex(index);

  if (searchOnly) {
    const q = searchOnly.toLowerCase();
    const hits = Object.values(index.packages).filter((row) => {
      const blob = [
        row.name,
        row.npm,
        row.url,
        row.description,
        ...(row.httpPaths || []),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return blob.includes(q);
    });
    console.log(`search "${searchOnly}": ${hits.length}`);
    for (const h of hits.slice(0, 80)) {
      console.log(
        [
          h.status,
          h.npm || h.name,
          (h.httpPaths || []).slice(0, 4).join(" "),
          (h.description || "").slice(0, 60),
        ].join(" | "),
      );
    }
    return;
  }

  if (catalogOnly) {
    console.log("catalog-only done");
    return;
  }

  let targets = plugins.filter(
    (p) => typeof p.npm === "string" && p.npm.trim().length > 0,
  );
  // Prefer higher downloads first for early useful local search.
  targets.sort(
    (a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0),
  );
  if (limit > 0) targets = targets.slice(0, limit);

  console.log(
    `pack targets: ${targets.length} (concurrency=${concurrency}, resume skips ok)`,
  );

  let ok = 0;
  let skip = 0;
  let fail = 0;

  await mapPool(targets, concurrency, async (p) => {
    const npm = p.npm.trim();
    const key = npm;
    try {
      const id = safeId(npm);
      const dest = path.join(root, "packs", id);
      const pkgJson = path.join(dest, "package", "package.json");
      if (fs.existsSync(pkgJson)) {
        const client = findClientJs(path.join(dest, "package"));
        const httpPaths = client ? extractHttpPaths(client) : [];
        index.packages[key] = {
          ...(index.packages[key] || {}),
          name: p.name,
          npm,
          url: p.url || null,
          version: p.version || null,
          status: "ok",
          packDir: path.join("packs", id, "package"),
          httpPaths,
          client: client
            ? path.relative(root, client).split(path.sep).join("/")
            : null,
        };
        skip++;
        return;
      }

      const result = npmPack(npm, dest);
      if (!result.ok) {
        index.packages[key] = {
          ...(index.packages[key] || {}),
          name: p.name,
          npm,
          url: p.url || null,
          status: "pack-failed",
          error: result.error,
        };
        fail++;
        console.log("FAIL", npm, result.error?.slice(0, 120));
        return;
      }
      const client = findClientJs(path.join(dest, "package"));
      const httpPaths = client ? extractHttpPaths(client) : [];
      index.packages[key] = {
        ...(index.packages[key] || {}),
        name: p.name,
        npm,
        url: p.url || null,
        version: p.version || null,
        status: "ok",
        packDir: path.join("packs", id, "package"),
        httpPaths,
        client: client
          ? path.relative(root, client).split(path.sep).join("/")
          : null,
      };
      ok++;
      if ((ok + fail) % 25 === 0) {
        saveIndex(index);
        console.log(`progress ok=${ok} skip=${skip} fail=${fail}`);
      }
    } catch (err) {
      fail++;
      const message = err instanceof Error ? err.message : String(err);
      index.packages[key] = {
        ...(index.packages[key] || {}),
        name: p.name,
        npm,
        url: p.url || null,
        status: "pack-failed",
        error: message.slice(0, 400),
      };
      console.log("FAIL", npm, message.slice(0, 120));
    }
  });

  saveIndex(index);
  const summary = {
    root,
    ok,
    skip,
    fail,
    indexed: Object.keys(index.packages).length,
  };
  fs.writeFileSync(
    path.join(root, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log("done", summary);
  console.log(
    "search: node scripts/dsh-community-mirror.mjs --search=skin",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
