import fs from "node:fs";
import path from "node:path";

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (["node_modules", "dist", "lib"].includes(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, o);
    else if (e.name === "locales.ts" || e.name === "archived-locales.ts") o.push(f);
  }
  return o;
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

function countKeys(body) {
  const re =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|[A-Za-z_][\w.]*)\s*:/gm;
  let n = 0;
  let m;
  while ((m = re.exec(body))) n += 1;
  return n;
}

for (const f of walk("packages/client")) {
  const src = fs.readFileSync(f, "utf8");
  const ja = extractObj(src, "ja") || extractObj(src, "archivedJa");
  const zh = extractObj(src, "zh") || extractObj(src, "archivedZh") || extractObj(src, "en");
  if (!zh) {
    console.log("NO ZH/EN", f);
    continue;
  }
  const zk = countKeys(zh);
  const jk = ja ? countKeys(ja) : -1;
  if (jk !== zk) console.log(path.relative(".", f), "zh/en", zk, "ja", jk);
}
