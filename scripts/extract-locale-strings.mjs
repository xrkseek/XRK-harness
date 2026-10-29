import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "packages", "client");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "lib"].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.name === "locales.ts" || ent.name === "archived-locales.ts") out.push(full);
  }
  return out;
}

function extractObj(src, id) {
  const re = new RegExp(
    String.raw`export\s+const\s+${id}(?:\s*:\s*[^=]+?)?\s*=\s*\{`,
  );
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let inStr = null;
  let esc = false;
  const start = i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    i += 1;
  }
  return src.slice(start, i - 1);
}

function parseEntries(body) {
  const out = {};
  const re =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w.]*))\s*:\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)")/gm;
  let m;
  while ((m = re.exec(body))) {
    const k = m[1] || m[2] || m[3];
    const raw = m[4] ?? m[5];
    out[k] = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
  return out;
}

const pairs = [];
const enSet = new Map();
const zhSet = new Map();

for (const file of walk(CLIENT)) {
  const src = fs.readFileSync(file, "utf8");
  const zhBody =
    extractObj(src, "zh") ||
    extractObj(src, "archivedZh");
  const enBody =
    extractObj(src, "en") ||
    extractObj(src, "archivedEn");
  if (!zhBody || !enBody) continue;
  const zh = parseEntries(zhBody);
  const en = parseEntries(enBody);
  for (const k of Object.keys(zh)) {
    const e = en[k] ?? zh[k];
    const z = zh[k];
    pairs.push({ file: path.relative(ROOT, file).replaceAll("\\", "/"), key: k, en: e, zh: z });
    enSet.set(e, (enSet.get(e) || 0) + 1);
    zhSet.set(z, (zhSet.get(z) || 0) + 1);
  }
}

fs.writeFileSync(
  path.join(ROOT, "scripts", ".locale-pairs.json"),
  JSON.stringify(pairs, null, 2),
);
fs.writeFileSync(
  path.join(ROOT, "scripts", ".locale-en-unique.json"),
  JSON.stringify([...enSet.keys()].sort(), null, 2),
);
fs.writeFileSync(
  path.join(ROOT, "scripts", ".locale-zh-unique.json"),
  JSON.stringify([...zhSet.keys()].sort(), null, 2),
);
console.log(`pairs=${pairs.length} uniqueEn=${enSet.size} uniqueZh=${zhSet.size}`);
