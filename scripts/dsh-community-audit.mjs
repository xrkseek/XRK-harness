/**
 * Scan staged community client.js against dsh-compat HTTP capability table.
 *
 *   pnpm exec tsc -b packages/server/http
 *   node scripts/dsh-community-audit.mjs [pluginsRoot]
 *
 * Default pluginsRoot: %USERPROFILE%/.xrk/plugins/web/plugins
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".xrk",
    "plugins",
    "web",
    "plugins",
  );

const here = path.dirname(fileURLToPath(import.meta.url));
const distAudit = path.join(
  here,
  "../packages/server/http/dist/dsh-compat/audit-community-client.js",
);
if (!fs.existsSync(distAudit)) {
  console.error("Build server-http first: pnpm exec tsc -b packages/server/http");
  process.exit(1);
}

const { auditCommunityClientSurface } = await import(
  pathToFileURL(distAudit).href
);

const missingByPlugin = new Map();

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "client.js") {
      const id = path.relative(root, path.dirname(p)).split(path.sep).join("/");
      const audit = auditCommunityClientSurface(path.dirname(p));
      if (audit.missingHttp.length > 0) {
        missingByPlugin.set(id, audit.missingHttp);
      }
      console.log(
        id,
        "http",
        audit.httpPaths.length,
        "rpc",
        audit.rpcChannels.length,
        audit.missingHttp.length ? `MISSING ${audit.missingHttp.length}` : "ok",
      );
    }
  }
}

if (!fs.existsSync(root)) {
  console.log("no staged plugins at", root);
  console.log(
    "install with: xrk-harness plugin add <spec>  (community client packages)",
  );
  process.exit(0);
}

walk(root);
if (missingByPlugin.size === 0) {
  console.log("All scanned HTTP paths are covered by the capability table.");
} else {
  console.log("--- uncovered HTTP paths ---");
  for (const [id, paths] of [...missingByPlugin.entries()].sort()) {
    console.log(id, paths.join(", "));
  }
}
