/**
 * Assert every client locale dictionary ships matching zh / en / ja key sets.
 * Scans packages/client locale dictionaries (combined locales.ts and
 * zh.ts / en.ts / ja.ts triplets under locales/).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "packages", "client");
const LOCALES = ["zh", "en", "ja"] as const;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "lib") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

/** Extract top-level string keys from `export const <id> = { ... }`. */
function extractKeys(source: string, exportId: string): Set<string> | null {
  const re = new RegExp(
    String.raw`export\s+const\s+${exportId}(?:\s*:\s*[^=]+?)?\s*=\s*\{`,
    "m",
  );
  const m = re.exec(source);
  if (!m || m.index === undefined) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let inStr: '"' | "'" | "`" | null = null;
  let escape = false;
  const bodyStart = i;
  while (i < source.length && depth > 0) {
    const c = source[i]!;
    if (inStr) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
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
  const body = source.slice(bodyStart, i - 1);
  return collectObjectKeys(body);
}

/** Collect top-level object keys without matching text inside string values. */
function collectObjectKeys(body: string): Set<string> {
  const keys = new Set<string>();
  let i = 0;
  let expectKey = true;
  while (i < body.length) {
    const c = body[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    // Skip // and /* */ comments (e.g. "Keep short: …" must not become a key).
    if (c === "/" && body[i + 1] === "/") {
      i += 2;
      while (i < body.length && body[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      i += 2;
      while (i + 1 < body.length && !(body[i] === "*" && body[i + 1] === "/")) i += 1;
      i = Math.min(i + 2, body.length);
      continue;
    }
    if (c === ",") {
      expectKey = true;
      i += 1;
      continue;
    }
    if (!expectKey) {
      // Skip a value (string / identifier / number / nested — values here are strings).
      if (c === "'" || c === '"' || c === "`") {
        const quote = c;
        i += 1;
        let esc = false;
        while (i < body.length) {
          const ch = body[i]!;
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === quote) {
            i += 1;
            break;
          }
          i += 1;
        }
        expectKey = false;
        continue;
      }
      // Identifier / number value (e.g. PLAN_NEXT_ACTION_ZH)
      const valueStart = i;
      while (i < body.length && /[\w.$]/.test(body[i]!)) i += 1;
      if (i === valueStart) i += 1; // avoid stalling on unexpected chars
      continue;
    }
    // Parse key
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      let key = "";
      let esc = false;
      while (i < body.length) {
        const ch = body[i]!;
        if (esc) {
          key += ch;
          esc = false;
        } else if (ch === "\\") esc = true;
        else if (ch === quote) {
          i += 1;
          break;
        } else key += ch;
        i += 1;
      }
      while (i < body.length && /\s/.test(body[i]!)) i += 1;
      if (body[i] === ":") {
        keys.add(key);
        i += 1;
        expectKey = false;
      }
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let key = "";
      while (i < body.length && /[\w.]/.test(body[i]!)) {
        key += body[i]!;
        i += 1;
      }
      while (i < body.length && /\s/.test(body[i]!)) i += 1;
      if (body[i] === ":") {
        keys.add(key);
        i += 1;
        expectKey = false;
      }
      continue;
    }
    i += 1;
  }
  return keys;
}

function checkCombinedLocalesTs(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const errors: string[] = [];
  const sets: Partial<Record<(typeof LOCALES)[number], Set<string>>> = {};
  for (const id of LOCALES) {
    const keys = extractKeys(src, id);
    if (!keys) {
      // settings.ts under locales/ may only export some — handled by triplet path
      if (id === "zh" && !src.includes("export const zh")) return errors;
      errors.push(`${rel(file)}: missing export const ${id}`);
      continue;
    }
    sets[id] = keys;
  }
  if (!sets.zh || !sets.en || !sets.ja) return errors;
  return diffKeys(rel(file), sets.zh, sets.en, sets.ja);
}

function checkTripletDir(dir: string): string[] {
  const zhPath = path.join(dir, "zh.ts");
  const enPath = path.join(dir, "en.ts");
  const jaPath = path.join(dir, "ja.ts");
  if (!fs.existsSync(zhPath)) return [];
  const errors: string[] = [];
  if (!fs.existsSync(enPath)) errors.push(`${rel(dir)}: missing en.ts`);
  if (!fs.existsSync(jaPath)) errors.push(`${rel(dir)}: missing ja.ts`);
  if (errors.length) return errors;
  const zh = extractKeys(fs.readFileSync(zhPath, "utf8"), "zh");
  const en = extractKeys(fs.readFileSync(enPath, "utf8"), "en");
  const ja = extractKeys(fs.readFileSync(jaPath, "utf8"), "ja");
  if (!zh || !en || !ja) {
    errors.push(`${rel(dir)}: could not parse zh/en/ja exports`);
    return errors;
  }
  return diffKeys(rel(dir), zh, en, ja);
}

function diffKeys(
  label: string,
  zh: Set<string>,
  en: Set<string>,
  ja: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const [name, set] of [
    ["en", en],
    ["ja", ja],
  ] as const) {
    for (const k of zh) {
      if (!set.has(k)) errors.push(`${label}: ${name} missing key "${k}"`);
    }
    for (const k of set) {
      if (!zh.has(k)) errors.push(`${label}: ${name} extra key "${k}"`);
    }
  }
  return errors;
}

function rel(p: string): string {
  return path.relative(ROOT, p).replaceAll("\\", "/");
}

function main(): void {
  const files = walk(CLIENT);
  const errors: string[] = [];
  const seenTriplets = new Set<string>();

  for (const file of files) {
    const base = path.basename(file);
    const dir = path.dirname(file);
    if (base === "locales.ts") {
      errors.push(...checkCombinedLocalesTs(file));
      continue;
    }
    if (base === "zh.ts" && path.basename(dir) === "locales") {
      const key = dir;
      if (seenTriplets.has(key)) continue;
      seenTriplets.add(key);
      errors.push(...checkTripletDir(dir));
    }
  }

  // settings.ts next to zh/en/ja under locale package
  const settingsPath = path.join(CLIENT, "locale", "src", "locales", "settings.ts");
  if (fs.existsSync(settingsPath)) {
    errors.push(...checkCombinedLocalesTs(settingsPath));
  }

  if (errors.length) {
    console.error(`verify-locale-parity: ${errors.length} issue(s)`);
    for (const e of errors.slice(0, 80)) console.error(`  ${e}`);
    if (errors.length > 80) console.error(`  … ${errors.length - 80} more`);
    process.exit(1);
  }
  console.log("verify-locale-parity: zh/en/ja key sets match.");
}

main();
