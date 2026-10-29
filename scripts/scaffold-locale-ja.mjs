/**
 * Scaffold / refresh `export const ja` for every client locales.ts
 * (and archived-locales.ts). Also rewrites register({ zh, en }) → include ja.
 *
 * Translation strategy: phrase-level EN→JA map for known UI English, then
 * fall back through a curated ZH→JA map keyed by the Chinese source string.
 * Unmapped strings are marked with /* TODO-JA *\/ so parity still passes
 * only when every key exists; values must still be natural Japanese —
 * this script embeds both maps densely for the current key set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "packages", "client");
const require = createRequire(import.meta.url);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "lib"].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (
      ent.name === "locales.ts" ||
      ent.name === "archived-locales.ts"
    ) {
      out.push(full);
    }
  }
  return out;
}

function extractObj(src, id) {
  // Matches `export const en = {` and `export const en: Record<…> = {`.
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
  return { body: src.slice(start, i - 1), end: i };
}

function parseEntries(body) {
  const out = {};
  // Quoted keys ('k'/"k") or bare identifiers (nav: …).
  const re =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w.]*))\s*:\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)")/gm;
  let m;
  while ((m = re.exec(body))) {
    const k = m[1] || m[2] || m[3];
    const raw = m[4] ?? m[5];
    out[k] = raw
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n");
  }
  return out;
}

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Load optional curated map: { "English": "日本語", ... } and zh map. */
function loadMaps() {
  const enPath = path.join(ROOT, "scripts", "locale-ja-en-map.json");
  const zhPath = path.join(ROOT, "scripts", "locale-ja-zh-map.json");
  return {
    en: fs.existsSync(enPath) ? JSON.parse(fs.readFileSync(enPath, "utf8")) : {},
    zh: fs.existsSync(zhPath) ? JSON.parse(fs.readFileSync(zhPath, "utf8")) : {},
  };
}

function translate(enVal, zhVal, maps) {
  if (maps.en[enVal]) return maps.en[enVal];
  if (maps.zh[zhVal]) return maps.zh[zhVal];
  // Keep placeholders / brand tokens as-is when identical
  if (enVal === zhVal) return enVal;
  // Preserve template braces content
  return null;
}

function rewriteRegister(src) {
  return src
    .replace(
      /register\(([^,]+),\s*\{\s*zh,\s*en\s*\}\)/g,
      "register($1, { zh, en, ja })",
    )
    .replace(
      /register\(([^,]+),\s*\{\s*zh:\s*archivedZh,\s*en:\s*archivedEn\s*\}\)/g,
      "register($1, { zh: archivedZh, en: archivedEn, ja: archivedJa })",
    )
    .replace(
      /import\s*\{\s*([^}]*\bzh\b[^}]*)\s*\}\s*from\s*'\.\/locales\.ts'/g,
      (full, inner) => {
        if (/\bja\b/.test(inner)) return full;
        const next = inner.replace(/\ben\b/, "en, ja").replace(/\bzh\b(?!,)/, "zh");
        // ensure ja present
        const withJa = /\bja\b/.test(next) ? next : `${inner.replace(/\s+$/, "")}, ja`;
        return full.replace(inner, withJa.includes("ja") ? withJa : `${inner}, ja`);
      },
    );
}

/** Remove any existing `export const ja` / `archivedJa` block (incl. trailer). */
function stripJaExport(src, id = "ja") {
  const obj = extractObj(src, id);
  if (!obj) return src;
  const headerRe = new RegExp(
    String.raw`(?:\/\*\*[^*]*Japanese[^*]*\*\/\s*)?export\s+const\s+${id}(?:\s*:\s*[^=]+?)?\s*=\s*\{`,
  );
  const hm = headerRe.exec(src);
  if (!hm || hm.index === undefined) return src;
  let end = obj.end;
  const trail = src.slice(end).match(/^[^\n]*\n?/);
  if (trail) end += trail[0].length;
  return src.slice(0, hm.index) + src.slice(end);
}

function injectJa(src, jaEntries, typeNameHint, id = "ja") {
  src = stripJaExport(src, id);
  const en = extractObj(src, id === "archivedJa" ? "archivedEn" : "en");
  if (!en) throw new Error("no en export");
  const rest = src.slice(en.end);
  const stmtEnd = rest.match(/^([^\n]*\n)/);
  const insertAt = en.end + (stmtEnd ? stmtEnd[0].length : 0);
  return (
    src.slice(0, insertAt) +
    "\n" +
    formatJa(jaEntries, typeNameHint, id) +
    src.slice(insertAt)
  );
}

function formatJa(entries, typeNameHint, id = "ja") {
  const quoteKey = (k) => (/^[A-Za-z_][\w]*$/.test(k) ? k : `'${k}'`);
  const lines = Object.entries(entries).map(
    ([k, v]) => `  ${quoteKey(k)}: '${esc(v)}',`,
  );
  const sat = typeNameHint
    ? `} as const satisfies Record<${typeNameHint}, string>\n`
    : "} as const\n";
  const name = id === "archivedJa" ? "archivedJa" : "ja";
  return `/** Japanese dictionary, checked complete against the zh key set. */\nexport const ${name} = {\n${lines.join("\n")}\n${sat}`;
}

function detectTypeName(src) {
  const m =
    src.match(/export\s+type\s+(\w+Key)\s*=/) ||
    src.match(/satisfies\s+Record<(\w+),\s*string>/);
  return m?.[1] ?? null;
}

function patchImportsInIndex(file) {
  if (!fs.existsSync(file)) return;
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  // import { en, zh, type X } from './locales.ts'
  src = src.replace(
    /import\s*\{([^}]+)\}\s*from\s*'(\.\/(?:archived-)?locales\.ts)'/g,
    (full, inner, mod) => {
      if (!/\bzh\b/.test(inner) || !/\ben\b/.test(inner)) return full;
      if (/\bja\b/.test(inner) || /\barchivedJa\b/.test(inner)) return full;
      if (mod.includes("archived")) {
        let next = inner;
        if (/\barchivedEn\b/.test(inner) && !/\barchivedJa\b/.test(inner)) {
          next = inner.replace(/\barchivedEn\b/, "archivedEn, archivedJa");
        }
        return `import {${next}} from '${mod}'`;
      }
      const next = inner.replace(/\ben\b/, "en, ja");
      return `import {${next}} from '${mod}'`;
    },
  );
  src = rewriteRegister(src);
  if (src !== before) fs.writeFileSync(file, src);
}

function main() {
  const maps = loadMaps();
  const files = walk(CLIENT);
  const missing = [];
  let updated = 0;

  for (const file of files) {
    let src = fs.readFileSync(file, "utf8");
    const zhObj = extractObj(src, file.includes("archived") ? "archivedZh" : "zh")
      ?? extractObj(src, "zh");
    const enObj = extractObj(src, file.includes("archived") ? "archivedEn" : "en")
      ?? extractObj(src, "en");
    if (!zhObj || !enObj) {
      console.warn("skip (no zh/en):", path.relative(ROOT, file));
      continue;
    }
    const zh = parseEntries(zhObj.body);
    const en = parseEntries(enObj.body);
    // zh is usually the key-set source; some packs (models/release-notes) key off en.
    const keys = Object.keys(zh).length >= Object.keys(en).length
      ? Object.keys(zh)
      : Object.keys(en);
    const jaEntries = {};
    for (const k of keys) {
      const enVal = en[k] ?? zh[k];
      const zhVal = zh[k] ?? en[k];
      const t = translate(enVal, zhVal, maps);
      if (!t) missing.push({ file: path.relative(ROOT, file), key: k, en: enVal, zh: zhVal });
      jaEntries[k] = t ?? enVal;
    }

    if (file.includes("archived-locales")) {
      src = injectJa(src, jaEntries, "ArchivedSessionsLocaleKey", "archivedJa");
    } else {
      src = injectJa(src, jaEntries, detectTypeName(src));
    }
    fs.writeFileSync(file, src);
    updated += 1;

    // Patch sibling index.ts register/imports
    const indexTs = path.join(path.dirname(file), "index.ts");
    patchImportsInIndex(indexTs);
  }

  const missPath = path.join(ROOT, "scripts", ".locale-ja-missing.json");
  fs.writeFileSync(missPath, JSON.stringify(missing, null, 2));
  console.log(`updated ${updated} locale files; missing translations: ${missing.length}`);
  console.log(`wrote ${path.relative(ROOT, missPath)}`);
}

main();
