import fs from "node:fs";

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

function keys(body) {
  const out = new Set();
  const re =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w.]*))\s*:/gm;
  let m;
  while ((m = re.exec(body))) out.add(m[1] || m[2] || m[3]);
  return out;
}

for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8");
  const zh = keys(extractObj(src, "zh") || "");
  const en = keys(extractObj(src, "en") || "");
  const ja = keys(extractObj(src, "ja") || "");
  const base = zh.size >= en.size ? zh : en;
  console.log(f, "base", base.size, "ja", ja.size);
  console.log("  missing from ja", [...base].filter((k) => !ja.has(k)));
  console.log("  extra in ja", [...ja].filter((k) => !base.has(k)));
}
