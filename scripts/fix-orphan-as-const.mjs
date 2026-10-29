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

let fixed = 0;
for (const f of walk("packages/client")) {
  const src = fs.readFileSync(f, "utf8");
  // Drop orphan lines that are only whitespace + `as const…`
  const next = src.replace(/^\s*as const[^\n]*\n/gm, "");
  if (next !== src) {
    fs.writeFileSync(f, next);
    fixed += 1;
    console.log("fixed", f);
  }
}
console.log("files fixed:", fixed);
